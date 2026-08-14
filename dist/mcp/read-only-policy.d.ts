import type { GITNEXUS_TOOLS } from './tools.js';
type GitNexusTool = (typeof GITNEXUS_TOOLS)[number];
export declare const MCP_READ_ONLY_TOOLS: Set<string>;
export declare function resolveMcpReadOnlyMode(env?: NodeJS.ProcessEnv): boolean;
export declare function assertMcpReadOnlyToolCall(toolName: string, args: Record<string, unknown> | undefined, readOnly: boolean): void;
export declare function readOnlyResourceTemplateAllowed(uriTemplate: string, readOnly: boolean): boolean;
export declare function assertMcpReadOnlyResource(uri: string, readOnly: boolean): void;
export declare function filterMcpReadOnlyResourceContent(content: string, readOnly: boolean): string;
/** Shared with repository-policy.ts so both policies scrub identically. */
export declare function scrubGroupDescription(description: string): string;
export declare function toolForReadOnlyMcp(tool: GitNexusTool, readOnly: boolean): GitNexusTool;
export {};
