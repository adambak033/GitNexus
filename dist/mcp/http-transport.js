/**
 * Dedicated MCP HTTP server.
 *
 * Provides HTTP-based MCP transport supporting:
 * - Modern Streamable HTTP: POST /mcp
 * - Legacy SSE transport: GET /sse + POST /messages
 *
 * Started via `gitnexus mcp --http`.
 * stdio remains the default mode for `gitnexus mcp` (no breaking change).
 *
 * Exports createStreamableHttpHandler and createSseHandlers so that
 * server/mcp-http.ts (web-UI route mount) can reuse them without inverting
 * the established server/ → mcp/ dependency direction.
 *
 * Security considerations:
 * - Default binds to 127.0.0.1 (loopback only).
 * - Use --auth-token to enable Bearer Token authentication.
 * - Use --host 0.0.0.0 to expose to all interfaces (requires --auth-token — refuses to start otherwise).
 * - CORS is restricted to loopback origins when no auth token is configured.
 * - PNA (Private Network Access) header is emitted only in response to browser preflight requests.
 */
import { timingSafeEqual, randomUUID } from 'crypto';
import express from 'express';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMCPServer, installSignalShutdown } from './server.js';
import { logger } from '../core/logger.js';
import { createMcpRepositoryPolicy, mcpRepositoryPolicyConfigured, } from './repository-policy.js';
/** Sessions idle longer than this are evicted. */
const SESSION_TTL_MS = 30 * 60 * 1000;
/** Cleanup sweep runs every 5 minutes. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
/** Hard cap on concurrent sessions — guards against initialize-flood DoS. */
const MAX_SESSIONS = 1000;
/**
 * Creates a Bearer Token authentication middleware.
 *
 * - When authToken is not set, all requests pass through.
 * - When authToken is set, checks the Authorization: Bearer <token> header.
 * - Uses constant-time comparison to prevent timing oracle attacks.
 * - Returns a JSON-RPC formatted 401 on failure.
 */
export function createAuthMiddleware(authToken) {
    return (req, res, next) => {
        if (!authToken) {
            next();
            return;
        }
        const header = req.headers['authorization'];
        const expected = `Bearer ${authToken}`;
        // Constant-time comparison — prevents timing oracle on bearer token.
        // Buffers must be the same byte-length for timingSafeEqual; mismatch means
        // we create a same-length dummy so the comparison always runs in full.
        let valid = false;
        if (typeof header === 'string') {
            const a = Buffer.from(header);
            const b = Buffer.from(expected);
            if (a.length === b.length) {
                valid = timingSafeEqual(a, b);
            }
            else {
                // Different lengths — run dummy comparison to preserve constant time.
                timingSafeEqual(Buffer.alloc(b.length), b);
            }
        }
        if (valid) {
            next();
            return;
        }
        res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Unauthorized' },
            id: null,
        });
    };
}
/**
 * Returns true when an Origin should be allowed by the no-auth (loopback-only)
 * CORS policy — i.e. it is absent (non-browser caller) or a loopback origin.
 *
 * WHATWG URL keeps the brackets on IPv6 literals
 * (`new URL('http://[::1]/').hostname === '[::1]'`) and canonicalizes the
 * IPv4-mapped loopback to `[::ffff:7f00:1]`; loopback IPv4 is the whole
 * 127.0.0.0/8 block — so all of those forms are matched explicitly.
 */
export function isLoopbackOrigin(origin) {
    if (!origin)
        return true; // no Origin → non-browser caller; CORS is not the control there
    let hostname;
    try {
        ({ hostname } = new URL(origin));
    }
    catch {
        return false;
    }
    return (hostname === 'localhost' ||
        hostname === '[::1]' ||
        hostname === '[::ffff:7f00:1]' ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname));
}
/** True for the exact loopback bind addresses. */
export function isLoopbackHost(host) {
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
/** True for any-interface wildcard binds, whose externally-used Host is unknowable. */
export function isWildcardHost(host) {
    return host === '0.0.0.0' || host === '::';
}
/**
 * Computes the SDK DNS-rebinding `allowedHosts` list (a Host-header allowlist) for a
 * bind host/port, or `undefined` when protection should stay off.
 *
 * Wildcard binds (`0.0.0.0` / `::`) return `undefined` — the Host a client
 * legitimately uses is unknowable, so the bearer token (required for non-loopback
 * binds) is the control. Loopback binds allow all three loopback host forms
 * (bare + `:port`); a specific host (e.g. `192.168.1.50`) allows that host
 * (bare + `:port`), which is knowable and a free defence-in-depth win.
 */
export function computeAllowedHosts(host, port) {
    if (isWildcardHost(host))
        return undefined;
    const hosts = isLoopbackHost(host) ? ['127.0.0.1', 'localhost', '[::1]'] : [host];
    return hosts.flatMap((h) => [h, `${h}:${port}`]);
}
/**
 * Resolves the MCP HTTP bearer token from the `--auth-token` flag or the
 * `GITNEXUS_MCP_AUTH_TOKEN` env var (the flag wins). An empty or whitespace-only
 * value is treated as "no token" so a blank env var cannot silently disable auth
 * (and slip past the non-loopback hard-fail).
 */
export function resolveAuthToken(optToken, env) {
    return (optToken ?? env.GITNEXUS_MCP_AUTH_TOKEN)?.trim() || undefined;
}
/** Builds the SDK transport DNS-rebinding options from a bind host/port. */
function dnsRebindingOptions(host, port) {
    if (host === undefined || port === undefined)
        return {};
    const allowedHosts = computeAllowedHosts(host, port);
    return allowedHosts ? { enableDnsRebindingProtection: true, allowedHosts } : {};
}
/**
 * Starts a periodic sweep that closes and evicts sessions idle longer than
 * `ttlMs`, returning the (unref'd) timer. Shared by both transport factories to
 * guard against network drops where the per-session onclose never fires.
 */
export function startIdleSweep(sessions, ttlMs, intervalMs) {
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [id, session] of sessions) {
            if (now - session.lastActivity > ttlMs) {
                try {
                    session.server.close();
                }
                catch { }
                sessions.delete(id);
            }
        }
    }, intervalMs);
    if (timer && typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
    }
    return timer;
}
/**
 * Creates a reusable StreamableHTTP request handler.
 *
 * Encapsulates the session map and request-dispatch logic as an independent
 * factory, reused by both startMcpHttpServer (POST /mcp) and the web-UI server
 * route mount in server/mcp-http.ts (/api/mcp).
 */
export function createStreamableHttpHandler(backend, opts = {}) {
    if (opts.createServer && !opts.repositoryPolicy && mcpRepositoryPolicyConfigured()) {
        throw new Error('A custom MCP server factory cannot bypass configured repository policy.');
    }
    // Seam: tests inject createServer to observe the per-session Server lifecycle.
    let repositoryPolicy = opts.repositoryPolicy
        ? Promise.resolve(opts.repositoryPolicy)
        : undefined;
    const getRepositoryPolicy = () => (repositoryPolicy ??= createMcpRepositoryPolicy(backend));
    // DNS-rebinding protection (Host-header allowlist) when the bind host is known.
    const dnsRebinding = dnsRebindingOptions(opts.host, opts.port);
    const sessions = new Map();
    const cleanupTimer = startIdleSweep(sessions, SESSION_TTL_MS, CLEANUP_INTERVAL_MS);
    const handler = async (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        if (sessionId && sessions.has(sessionId)) {
            // Existing session — delegate to its transport and refresh activity timestamp.
            // `has` just returned true and the map is not mutated before `get`, so the
            // lookup is non-null.
            const session = sessions.get(sessionId);
            session.lastActivity = Date.now();
            await session.transport.handleRequest(req, res, req.body);
        }
        else if (sessionId) {
            // Unknown / expired session ID — tell the client to re-initialize (per MCP spec).
            res.status(404).json({
                jsonrpc: '2.0',
                error: { code: -32001, message: 'Session not found. Re-initialize.' },
                id: null,
            });
        }
        else if (req.method === 'POST') {
            // No session ID — new client. Only accept initialize requests to avoid
            // orphaned Server instances that can never be reclaimed by the TTL sweep.
            // Use the SDK's isInitializeRequest so a single-element JSON-RPC batch is
            // recognised too, rather than a brittle `body.method === 'initialize'` check.
            const body = req.body;
            const messages = Array.isArray(body) ? body : [body];
            if (!messages.some(isInitializeRequest)) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32000,
                        message: 'First request must be initialize. No session ID provided.',
                    },
                    id: null,
                });
                return;
            }
            // Reject when the session cap is reached — prevents memory exhaustion via
            // an initialize flood (each session holds a live Server + Transport).
            if (sessions.size >= MAX_SESSIONS) {
                res.status(503).json({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Server at session capacity. Try again later.' },
                    id: null,
                });
                return;
            }
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                ...dnsRebinding,
            });
            const server = opts.createServer
                ? opts.createServer()
                : createMCPServer(backend, { repositoryPolicy: await getRepositoryPolicy() });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            if (transport.sessionId) {
                sessions.set(transport.sessionId, { server, transport, lastActivity: Date.now() });
                const sid = transport.sessionId;
                transport.onclose = () => {
                    sessions.delete(sid);
                };
            }
            else {
                // The SDK rejected this request (e.g. 406 on a missing/invalid Accept header,
                // 415 on a bad Content-Type) before assigning a session id. The Server was
                // already connected but will never be stored, so the TTL sweep and cleanup()
                // can't reclaim it — close it now to avoid an orphaned-Server leak.
                try {
                    await server.close();
                }
                catch { }
            }
        }
        else {
            res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'No valid session. Send a POST to initialize.' },
                id: null,
            });
        }
    };
    const cleanup = async () => {
        clearInterval(cleanupTimer);
        const closers = [...sessions.values()].map(async (session) => {
            try {
                await Promise.resolve(session.server.close());
            }
            catch { }
        });
        sessions.clear();
        await Promise.allSettled(closers);
    };
    return { handler, cleanup };
}
/**
 * Creates legacy SSE transport handlers.
 *
 * GET /sse (or custom path) establishes the SSE stream;
 * POST /messages (or custom path) receives client JSON-RPC messages.
 *
 * Includes the same idle-TTL eviction as createStreamableHttpHandler to prevent
 * memory leaks when clients drop without closing the SSE connection cleanly.
 *
 * @param backend       LocalBackend instance
 * @param messagesPath  Path clients POST messages to (default: '/messages')
 */
export function createSseHandlers(backend, messagesPath = '/messages', opts = {}) {
    const maxSessions = opts.maxSessions ?? MAX_SESSIONS;
    let repositoryPolicy = opts.repositoryPolicy
        ? Promise.resolve(opts.repositoryPolicy)
        : undefined;
    const getRepositoryPolicy = () => (repositoryPolicy ??= createMcpRepositoryPolicy(backend));
    // DNS-rebinding protection (Host-header allowlist) when the bind host is known.
    const dnsRebinding = dnsRebindingOptions(opts.host, opts.port);
    const sseSessions = new Map();
    const cleanupTimer = startIdleSweep(sseSessions, SESSION_TTL_MS, CLEANUP_INTERVAL_MS);
    const sseHandler = async (req, res) => {
        // Cap concurrent SSE sessions — mirrors the streamable handler's MAX_SESSIONS
        // guard so a flood of held-open GET /sse connections cannot allocate unbounded
        // Server instances before the idle sweep reclaims them.
        if (sseSessions.size >= maxSessions) {
            res.status(503).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Server at session capacity. Try again later.' },
                id: null,
            });
            return;
        }
        // SSEServerTransport(endpoint, res, options): endpoint is the path clients POST to.
        const transport = new SSEServerTransport(messagesPath, res, dnsRebinding);
        const server = createMCPServer(backend, { repositoryPolicy: await getRepositoryPolicy() });
        sseSessions.set(transport.sessionId, { server, transport, lastActivity: Date.now() });
        transport.onclose = () => {
            sseSessions.delete(transport.sessionId);
        };
        res.on('close', () => {
            sseSessions.delete(transport.sessionId);
            try {
                server.close();
            }
            catch { }
        });
        // connect() calls transport.start(), which sends the SSE 'endpoint' event.
        await server.connect(transport);
    };
    const messageHandler = async (req, res) => {
        const sessionId = req.query['sessionId'] ??
            req.headers['mcp-session-id'];
        const entry = sessionId ? sseSessions.get(sessionId) : undefined;
        if (!entry) {
            res.status(404).json({
                jsonrpc: '2.0',
                error: { code: -32001, message: 'SSE session not found. Reconnect to /sse.' },
                id: null,
            });
            return;
        }
        // Refresh activity timestamp so the TTL sweep does not evict an active session.
        entry.lastActivity = Date.now();
        // express.json() has already parsed the body — pass it as the third argument
        // to avoid the SDK re-reading the already-consumed stream.
        await entry.transport.handlePostMessage(req, res, req.body);
    };
    const cleanup = async () => {
        clearInterval(cleanupTimer);
        const closers = [...sseSessions.values()].map(async ({ server }) => {
            try {
                await Promise.resolve(server.close());
            }
            catch { }
        });
        sseSessions.clear();
        await Promise.allSettled(closers);
    };
    return { sseHandler, messageHandler, cleanup };
}
/**
 * Creates and starts the dedicated MCP HTTP server.
 *
 * Mounts the following routes:
 * - GET /health      — health check (no auth required; for orchestrators/probes)
 * - POST /mcp        — Streamable HTTP (modern clients)
 * - GET /sse         — legacy SSE stream (old clients)
 * - POST /messages   — legacy SSE message endpoint
 *
 * @param backend   LocalBackend instance
 * @param options   Server configuration
 * @returns         The listening http.Server
 */
export async function startMcpHttpServer(backend, options) {
    const { port, host, authToken } = options;
    // Refuse to start an unauthenticated server on a non-loopback interface — that
    // would silently expose every indexed repo to anyone who can reach the host.
    // Loopback binds stay open by default; non-loopback binds require a token.
    if (!authToken && !isLoopbackHost(host)) {
        throw new Error(`Refusing to start the MCP HTTP server on a non-loopback host (${host}) without ` +
            'authentication — it would expose all indexed repos to anyone who can reach it. ' +
            'Pass --auth-token (or set GITNEXUS_MCP_AUTH_TOKEN), or bind --host 127.0.0.1. ' +
            'This applies to --host 0.0.0.0 and --host :: as well.');
    }
    const repositoryPolicy = options.repositoryPolicy ?? (await createMcpRepositoryPolicy(backend));
    const app = express();
    // Suppress X-Powered-By to reduce information leakage.
    app.disable('x-powered-by');
    // PNA (Chrome 130+ Private Network Access) preflight support.
    // The browser sends `Access-Control-Request-Private-Network: true` ONLY on the
    // CORS preflight (an OPTIONS request); emit the matching allow header only then,
    // never on actual GET/POST responses. Runs before cors() so the header survives
    // onto the preflight response cors() short-circuits.
    app.use((req, res, next) => {
        if (req.method === 'OPTIONS' &&
            req.headers['access-control-request-private-network'] === 'true') {
            res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
        next();
    });
    // CORS policy:
    // - With auth token: allow any origin (remote access is intentional and protected).
    // - Without auth token: restrict to loopback origins only to prevent drive-by local exfiltration.
    const corsOrigin = authToken
        ? true
        : (origin, cb) => {
            cb(null, isLoopbackOrigin(origin));
        };
    app.use(cors({
        origin: corsOrigin,
        credentials: false,
        allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'last-event-id'],
        exposedHeaders: ['mcp-session-id'],
    }));
    const auth = createAuthMiddleware(authToken);
    // Body parser applied per-route after auth, so unauthenticated requests never
    // trigger the 10 MB parse. Malformed/oversized JSON from authenticated clients
    // is converted to a JSON-RPC error envelope by the terminal error handler
    // registered after the routes (see below).
    const jsonBody = express.json({ limit: '10mb' });
    // Health check — no auth required; safe to expose for probes and orchestrators.
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
    });
    // Streamable HTTP (modern MCP clients) at POST /mcp.
    const streamable = createStreamableHttpHandler(backend, { host, port, repositoryPolicy });
    app.all('/mcp', auth, jsonBody, (req, res) => {
        void streamable.handler(req, res).catch((err) => {
            logger.error({ err }, 'MCP /mcp request failed');
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Internal MCP server error' },
                    id: null,
                });
            }
        });
    });
    // Legacy SSE: GET /sse opens the stream; POST /messages receives JSON-RPC messages.
    const sse = createSseHandlers(backend, '/messages', { host, port, repositoryPolicy });
    app.get('/sse', auth, (req, res) => {
        void sse.sseHandler(req, res).catch((err) => {
            logger.error({ err }, 'MCP /sse failed');
        });
    });
    app.post('/messages', auth, jsonBody, (req, res) => {
        void sse.messageHandler(req, res).catch((err) => {
            logger.error({ err }, 'MCP /messages failed');
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Internal error' },
                    id: null,
                });
            }
        });
    });
    // Terminal error handler: body-parser failures (malformed or oversized JSON)
    // reach here via next(err). Without it, Express's default handler returns an
    // HTML error page — leaking a stack trace and absolute install paths when
    // NODE_ENV is unset (the default for a CLI) — instead of the JSON-RPC envelope
    // every other path uses.
    app.use((err, _req, res, _next) => {
        const e = (err ?? {});
        const isBodyParseError = e.type === 'entity.parse.failed' ||
            e.type === 'entity.too.large' ||
            err instanceof SyntaxError;
        logger.error({ err }, 'MCP HTTP request error');
        if (res.headersSent)
            return;
        if (isBodyParseError) {
            res.status(e.status ?? e.statusCode ?? 400).json({
                jsonrpc: '2.0',
                error: { code: -32700, message: 'Parse error' },
                id: null,
            });
            return;
        }
        res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Internal MCP server error' },
            id: null,
        });
    });
    return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
            logger.info({ port, host }, `GitNexus MCP HTTP server listening on http://${displayHost}:${port}  ` +
                `(Streamable: POST /mcp · legacy SSE: GET /sse + POST /messages)`);
            resolve(server);
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.error({ port, host }, `Port ${port} is already in use. ` +
                    `Stop the conflicting process or use a different port: gitnexus mcp --http --port <other>`);
                process.exit(1);
            }
            reject(err);
        });
        const shutdown = async (exitCode) => {
            server.close();
            await streamable.cleanup();
            await sse.cleanup();
            try {
                await backend.disconnect();
            }
            catch { }
            const { flushLoggerSync } = await import('../core/logger.js');
            flushLoggerSync();
            process.exit(exitCode);
        };
        // Use the shared signal wiring so SIGINT exits 130 and SIGTERM exits 143
        // (the repo's POSIX 128+signal convention), not a misleading exit(0).
        installSignalShutdown((exitCode = 0) => void shutdown(exitCode));
    });
}
