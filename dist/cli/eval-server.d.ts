/**
 * Eval Server — Lightweight HTTP server for SWE-bench evaluation
 *
 * Keeps LadybugDB warm in memory so tool calls from the agent are near-instant.
 * Designed to run inside Docker containers during SWE-bench evaluation.
 *
 * KEY DESIGN: Returns LLM-friendly text, not raw JSON.
 * Raw JSON wastes tokens and is hard for models to parse. The text formatter
 * converts structured results into compact, readable output that models
 * can immediately act on. Next-step hints guide the agent through a
 * productive tool-chaining workflow (query → context → impact → fix).
 *
 * Architecture:
 *   Agent bash cmd → curl localhost:PORT/tool/query → eval-server → LocalBackend → format → text
 *
 * Usage:
 *   gitnexus eval-server                        # default port 4848, binds 127.0.0.1
 *   gitnexus eval-server --port 4848            # explicit port
 *   GITNEXUS_AUTH_TOKEN=... gitnexus eval-server --host 0.0.0.0
 *   GITNEXUS_AUTH_TOKEN=... gitnexus eval-server --host devbox.local
 *   gitnexus eval-server --idle-timeout 300     # auto-shutdown after 300s idle
 *
 * READY signal format: GITNEXUS_EVAL_SERVER_READY:<host>:<port>
 *   IPv4: GITNEXUS_EVAL_SERVER_READY:127.0.0.1:4848
 *   IPv6: GITNEXUS_EVAL_SERVER_READY:[::1]:4848
 *
 * API:
 *   POST /tool/:name   — Call a tool. Body is JSON arguments. Returns formatted text.
 *   GET  /health       — Health check. Returns {"status":"ok","repos":[...]}
 *   POST /shutdown     — Graceful shutdown.
 */
import { type RepoListing, type ListReposPagination } from '../mcp/local/local-backend.js';
export { formatDetectChangesResult } from './detect-changes-format.js';
export interface EvalServerOptions {
    port?: string;
    host?: string;
    idleTimeout?: string;
}
/**
 * Validate the --host value. Accepts IPv4, IPv6, or "localhost".
 * Returns the host string unchanged, or null if invalid.
 * "localhost" is passed through so the OS resolves it to the correct loopback
 * address (127.0.0.1 or ::1) at bind time rather than forcing IPv4.
 */
export declare function validateHost(raw: string): string | null;
type EvalServerHostLookup = (hostname: string) => Promise<string>;
/** Resolve a DNS bind name once so validation and listen() use the same concrete address. */
export declare function resolveEvalServerBindHost(raw: string, resolveHostname?: EvalServerHostLookup): Promise<string | null>;
/** Resolve the bearer token from the shell, then .env.local, then .env. */
export declare function resolveEvalServerAuthToken(env: NodeJS.ProcessEnv, cwd?: string): string | undefined;
/** True only for literal loopback addresses; DNS names are resolved before this check. */
export declare function isEvalServerLoopbackHost(host: string): boolean;
/**
 * Resolve the bearer token for a concrete bind host. An unreadable `.env` /
 * `.env.local` only matters when the binding actually requires a token, so
 * loopback binds degrade to a warning instead of refusing to start; any
 * non-loopback bind keeps the fail-closed error.
 */
export declare function resolveEvalServerAuthTokenForHost(host: string, env: NodeJS.ProcessEnv, cwd?: string): {
    token?: string;
    warning?: string;
};
/** Refuse exposure of the eval-server query surface without authentication. */
export declare function assertSecureEvalServerBinding(host: string, authToken: string | undefined): void;
/** Validate the exact Bearer header while keeping token comparison constant-time. */
export declare function isEvalServerBearerAuthorized(authorization: string | string[] | undefined, authToken: string | undefined): boolean;
export declare function formatQueryResult(result: any): string;
export declare function formatContextResult(result: any): string;
export declare function formatImpactResult(result: any): string;
export declare function formatCypherResult(result: any): string;
export declare function formatListReposResult(result: {
    repositories: RepoListing[];
    pagination?: ListReposPagination;
}): string;
export declare function getNextStepHint(toolName: string, result?: any): string;
export declare function evalServerCommand(options?: EvalServerOptions): Promise<void>;
/**
 * Tools the eval-server exposes over HTTP — the read-only query surface the
 * banner advertises. `LocalBackend.callTool` ALSO dispatches write-side / heavier
 * tools (rename, shape_check, tool_map, …); the allowlist keeps a stray
 * `POST /tool/<name>` from reaching those through this Docker/eval-harness server.
 */
export declare const EVAL_SERVER_TOOLS: ReadonlySet<string>;
export declare const MAX_BODY_SIZE: number;
