export declare const MCP_TOKEN_ESTIMATE_BYTES = 4;
export declare const MCP_TRUNCATION_MARKER = "\n\u2026";
export declare function resolveMcpMaxTokens(toolName: string, args: Record<string, unknown> | undefined, env?: NodeJS.ProcessEnv): number | undefined;
export declare function applyMcpMaxTokens(text: string, maxTokens: number | undefined): string;
export declare function withoutMcpBudgetArg(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
