/**
 * MCP Tool Definitions
 *
 * Defines the tools that GitNexus exposes to external AI agents.
 * All tools support an optional `repo` parameter for multi-repo setups.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
export interface ToolDefinition {
    name: string;
    description: string;
    annotations: ToolAnnotations;
    inputSchema: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            default?: unknown;
            items?: {
                type: string;
            };
            enum?: string[];
            minimum?: number;
            maximum?: number;
            minLength?: number;
        }>;
        required: string[];
    };
}
/**
 * Pagination bounds for the `list_repos` tool. Exported so the backend
 * validation (`local-backend.ts`) and the schema below stay a single source of
 * truth. `list_repos` is paginated to keep its response under MCP/LLM token
 * truncation limits when many repos are indexed (#2119); the default page is
 * small enough to render safely, and `LIST_REPOS_MAX_LIMIT` caps how much a
 * caller can pull in one request.
 */
export declare const LIST_REPOS_DEFAULT_LIMIT = 50;
export declare const LIST_REPOS_MAX_LIMIT = 200;
/**
 * Pagination bounds for the `explain` tool (#2083 M3 U6). Findings are sparse
 * and capped per function at analyze time, but a large repo can still
 * accumulate enough TAINTED rows to blow MCP/LLM token limits — the response
 * is page-bounded like `list_repos`. Exported so the backend clamp
 * (`local-backend.ts`) and the schema stay a single source of truth.
 */
export declare const EXPLAIN_DEFAULT_LIMIT = 50;
export declare const EXPLAIN_MAX_LIMIT = 200;
export declare const PDG_QUERY_DEFAULT_LIMIT = 50;
export declare const PDG_QUERY_MAX_LIMIT = 200;
export declare const IMPACT_MAX_DEPTH = 32;
export declare const GITNEXUS_TOOLS: ToolDefinition[];
/**
 * Per-repo tools that accept an optional `branch` scope (#2106). Single source
 * of truth: the schema property is injected here so it cannot drift from the
 * server-side default in `local-backend.ts` (`resolveRepo(repo, branch)`).
 * `list_repos` and the `group_*` tools are intentionally excluded — they are
 * not single-repo, single-branch operations.
 */
export declare const REPO_SCOPED_TOOLS: Set<string>;
