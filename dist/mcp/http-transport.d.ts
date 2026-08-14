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
import type { Server as HttpServer } from 'http';
import { type Request, type Response, type NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { LocalBackend } from './local/local-backend.js';
import { type McpRepositoryPolicy } from './repository-policy.js';
/** HTTP server configuration options. */
export interface McpHttpOptions {
    /** Listening port. */
    port: number;
    /** Bind address (default: 127.0.0.1). */
    host: string;
    /** Bearer auth token (optional; no auth when omitted). */
    authToken?: string;
    /** Prevalidated repository policy shared by startup logging and transports. */
    repositoryPolicy?: McpRepositoryPolicy;
}
/**
 * Creates a Bearer Token authentication middleware.
 *
 * - When authToken is not set, all requests pass through.
 * - When authToken is set, checks the Authorization: Bearer <token> header.
 * - Uses constant-time comparison to prevent timing oracle attacks.
 * - Returns a JSON-RPC formatted 401 on failure.
 */
export declare function createAuthMiddleware(authToken?: string): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Returns true when an Origin should be allowed by the no-auth (loopback-only)
 * CORS policy — i.e. it is absent (non-browser caller) or a loopback origin.
 *
 * WHATWG URL keeps the brackets on IPv6 literals
 * (`new URL('http://[::1]/').hostname === '[::1]'`) and canonicalizes the
 * IPv4-mapped loopback to `[::ffff:7f00:1]`; loopback IPv4 is the whole
 * 127.0.0.0/8 block — so all of those forms are matched explicitly.
 */
export declare function isLoopbackOrigin(origin: string | undefined): boolean;
/** True for the exact loopback bind addresses. */
export declare function isLoopbackHost(host: string): boolean;
/** True for any-interface wildcard binds, whose externally-used Host is unknowable. */
export declare function isWildcardHost(host: string): boolean;
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
export declare function computeAllowedHosts(host: string, port: number): string[] | undefined;
/**
 * Resolves the MCP HTTP bearer token from the `--auth-token` flag or the
 * `GITNEXUS_MCP_AUTH_TOKEN` env var (the flag wins). An empty or whitespace-only
 * value is treated as "no token" so a blank env var cannot silently disable auth
 * (and slip past the non-loopback hard-fail).
 */
export declare function resolveAuthToken(optToken: string | undefined, env: NodeJS.ProcessEnv): string | undefined;
/**
 * Starts a periodic sweep that closes and evicts sessions idle longer than
 * `ttlMs`, returning the (unref'd) timer. Shared by both transport factories to
 * guard against network drops where the per-session onclose never fires.
 */
export declare function startIdleSweep<T extends {
    server: Server;
    lastActivity: number;
}>(sessions: Map<string, T>, ttlMs: number, intervalMs: number): NodeJS.Timeout;
/**
 * Creates a reusable StreamableHTTP request handler.
 *
 * Encapsulates the session map and request-dispatch logic as an independent
 * factory, reused by both startMcpHttpServer (POST /mcp) and the web-UI server
 * route mount in server/mcp-http.ts (/api/mcp).
 */
export declare function createStreamableHttpHandler(backend: LocalBackend, opts?: {
    createServer?: () => Server;
    host?: string;
    port?: number;
    repositoryPolicy?: McpRepositoryPolicy;
}): {
    handler: (req: Request, res: Response) => Promise<void>;
    cleanup: () => Promise<void>;
};
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
export declare function createSseHandlers(backend: LocalBackend, messagesPath?: string, opts?: {
    maxSessions?: number;
    host?: string;
    port?: number;
    repositoryPolicy?: McpRepositoryPolicy;
}): {
    sseHandler: (req: Request, res: Response) => Promise<void>;
    messageHandler: (req: Request, res: Response) => Promise<void>;
    cleanup: () => Promise<void>;
};
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
export declare function startMcpHttpServer(backend: LocalBackend, options: McpHttpOptions): Promise<HttpServer>;
