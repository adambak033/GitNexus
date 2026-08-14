/**
 * HTTP API Server
 *
 * REST API for browser-based clients to query the local .gitnexus/ index.
 * Also hosts the MCP server over StreamableHTTP for remote AI tool access.
 *
 * Security: binds to localhost by default (use --host to override).
 * CORS is restricted to localhost, private/LAN networks, and the deployed site.
 */
import express from 'express';
import { type RegistryEntry } from '../storage/repo-manager.js';
import { type GraphNode, type GraphRelationship } from '../_shared/index.js';
/**
 * Determine whether an HTTP Origin header value is allowed by CORS policy.
 *
 * Permitted origins:
 * - No origin (non-browser requests such as curl or server-to-server calls)
 * - http://localhost:<port> — local development
 * - http://127.0.0.1:<port> — loopback alias
 * - RFC 1918 private/LAN networks (any port):
 *     10.0.0.0/8      → 10.x.x.x
 *     172.16.0.0/12   → 172.16.x.x – 172.31.x.x
 *     192.168.0.0/16  → 192.168.x.x
 * - https://gitnexus.vercel.app — the deployed GitNexus web UI
 * - the origin named by GITNEXUS_PUBLIC_ORIGIN, when set — matched on hostname
 *   always, and on scheme and port when the configured value carries them
 *
 * @param origin - The value of the HTTP `Origin` request header, or `undefined`
 *                 when the header is absent (non-browser request).
 * @returns `true` if the origin is allowed, `false` otherwise.
 */
export declare const isAllowedOrigin: (origin: string | undefined) => boolean;
type GraphStreamRecord = {
    type: 'node';
    data: GraphNode;
} | {
    type: 'relationship';
    data: GraphRelationship;
} | {
    type: 'error';
    error: string;
};
export declare class ClientDisconnectedError extends Error {
    constructor();
}
export declare const isIgnorableGraphQueryError: (err: unknown) => boolean;
export declare const SPA_FALLBACK_REGEX: RegExp;
export declare const resolveWebDistDir: (primaryDir: string, fallbackDir: string) => Promise<string | null>;
export declare const landingPageHtml: () => string;
export declare const staticCacheControlSetHeaders: (res: express.Response, filePath: string) => void;
export declare const registerWebUI: (app: express.Express, staticDir: string | null) => void;
export declare const writeNdjsonRecord: (res: express.Response, record: GraphStreamRecord, signal?: AbortSignal) => Promise<void>;
export declare const getNodeQuery: (table: string, includeContent: boolean) => string;
export declare const streamGraphNdjson: (res: express.Response, includeContent?: boolean, signal?: AbortSignal) => Promise<void>;
/**
 * Resolve a `?repo=` request param against the registry in two tiers:
 *
 *   1. Path claim — any input containing a separator ('/' or '\\', which
 *      cover path.sep on every platform) is treated as a path claim and
 *      resolved by canonical registry path ONLY. A miss fails closed
 *      (null, never a basename fallback) so a stale or wrong path can
 *      never silently retarget a same-named sibling repo (#2419).
 *      Within this tier, only absolute or Windows-shaped ('\\') claims
 *      are worth canonicalizing; relative claims like 'org/name' or
 *      './repo' are rejected immediately WITHOUT touching the filesystem
 *      — canonicalizing them would run an attacker-influenced
 *      CWD-relative realpathSync probe on un-rate-limited GET routes,
 *      and no legitimate caller sends relative paths.
 *   2. Name fallback — bare names (no separators) keep the legacy
 *      basename/name match for older callers.
 */
export declare const resolveRegisteredRepoEntry: (repos: RegistryEntry[], repoName?: string) => RegistryEntry | null;
/**
 * Handle a GET /api/file request body. Extracted from createServer's route
 * registration so it can be unit-tested without spinning up an HTTP server
 * — calling app.get(...) inside a test triggers CodeQL's
 * js/missing-rate-limiting query, which is appropriate for production
 * route handlers but a false positive for tests of the handler logic.
 *
 * The function takes the express req and res (typed loosely so test code
 * can pass minimal mocks) plus the resolved repo path. All path-traversal
 * containment is done inline at the readFile sink with the canonical
 * path.relative idiom for CodeQL js/path-injection recognition.
 */
export declare const handleFileRequest: (req: {
    query: any;
}, res: {
    status: (code: number) => {
        json: (body: any) => void;
    };
    json: (body: any) => void;
}, repoPath: string) => Promise<void>;
export declare const handleQueryRequest: (req: express.Request, res: express.Response, resolveRepo: (repoName?: string) => Promise<{
    storagePath: string;
} | undefined>) => Promise<void>;
/**
 * Validate the optional `token` field of POST /api/analyze. Returns an
 * { status, error } to send, or null when the token is absent or valid.
 *
 * The token is a GitHub PAT: charset-restricted (blocks CRLF header
 * smuggling), length-bounded (1–256), and bound to github.com using the SAME
 * GITHUB_TOKEN_HOSTS allowlist + hostname parse as resolveGitCredential, so a
 * token the API accepts is exactly the one buildGitEnv will inject — and one
 * it rejects is never sent off github.com.
 *
 * Exported for unit tests (the route validation is otherwise only reachable
 * by booting the server).
 */
export declare function validateAnalyzeToken(repoToken: unknown, repoUrl: unknown): {
    status: number;
    error: string;
} | null;
export declare const createServer: (port: number, host?: string) => Promise<void>;
export {};
