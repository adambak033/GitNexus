/**
 * MCP Server (Multi-Repo)
 *
 * Model Context Protocol server that runs on stdio.
 * External AI tools (Cursor, Claude) spawn this process and
 * communicate via stdin/stdout using the MCP protocol.
 *
 * Supports multiple indexed repositories via the global registry.
 *
 * Tools: list_repos, query, cypher, context, impact, detect_changes, rename
 * Resources: repos, repo/{name}/context, repo/{name}/clusters, ...
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { LocalBackend } from './local/local-backend.js';
import { McpRepositoryPolicy } from './repository-policy.js';
/**
 * Create a configured MCP Server with all handlers registered.
 * Transport-agnostic — caller connects the desired transport.
 */
export declare function createMCPServer(backend: LocalBackend, options?: {
    repositoryPolicy?: McpRepositoryPolicy;
}): Server;
/** Conventional 128 + signal-number exit codes for graceful termination. */
export declare const SHUTDOWN_EXIT_CODES: {
    readonly SIGINT: 130;
    readonly SIGTERM: 143;
};
type SignalRegistrar = (event: 'SIGINT' | 'SIGTERM', listener: (...args: unknown[]) => void) => void;
/**
 * Wire SIGINT/SIGTERM to a graceful shutdown using NUMERIC exit codes.
 *
 * Node invokes signal listeners with the signal NAME string as the first
 * argument, so registering an `(exitCode = 0) => process.exit(exitCode)`
 * shutdown directly passes `'SIGTERM'` into `process.exit()` and crashes with
 * `ERR_INVALID_ARG_TYPE` (#1132). These wrappers discard the signal argument
 * and pass the conventional 128+signal code instead. `on` is injectable so the
 * mapping can be unit-tested without touching the real process.
 */
export declare function installSignalShutdown(shutdown: (exitCode?: number) => unknown, on?: SignalRegistrar): void;
export declare function startMCPServer(backend: LocalBackend, repositoryPolicy?: McpRepositoryPolicy): Promise<void>;
export {};
