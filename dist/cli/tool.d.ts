/**
 * Direct CLI Tool Commands
 *
 * Exposes GitNexus tools (query, context, impact, cypher, check) as direct CLI commands.
 * Bypasses MCP entirely — invokes LocalBackend directly for minimal overhead.
 *
 * Usage:
 *   gitnexus query "authentication flow"
 *   gitnexus context --name "validateUser"
 *   gitnexus impact --target "AuthService" --direction upstream
 *   gitnexus cypher "MATCH (n:Function) RETURN n.name LIMIT 10"
 *
 * Note: Output goes to stdout via fs.writeSync(fd 1), bypassing LadybugDB's
 * native module which captures the Node.js process.stdout stream during init.
 * See the output() function for details (#324).
 */
export declare function queryCommand(queryText: string | undefined, options?: {
    query?: string;
    repo?: string;
    branch?: string;
    context?: string;
    goal?: string;
    limit?: string;
    content?: boolean;
}): Promise<void>;
export declare function contextCommand(name: string, options?: {
    repo?: string;
    branch?: string;
    file?: string;
    uid?: string;
    limit?: string;
    content?: boolean;
}): Promise<void>;
export declare function impactCommand(target?: string, options?: {
    direction?: string;
    mode?: string;
    line?: string;
    repo?: string;
    branch?: string;
    uid?: string;
    file?: string;
    kind?: string;
    depth?: string;
    includeTests?: boolean;
    limit?: string;
    offset?: string;
    summaryOnly?: boolean;
}): Promise<void>;
export declare function cypherCommand(query: string, options?: {
    repo?: string;
    branch?: string;
    limit?: string;
}): Promise<void>;
export declare function detectChangesCommand(options?: {
    scope?: string;
    baseRef?: string;
    repo?: string;
    branch?: string;
    limit?: string;
}): Promise<void>;
export declare function checkCommand(options?: {
    cycles?: boolean;
    json?: boolean;
    repo?: string;
    branch?: string;
}): Promise<void>;
export declare function traceCommand(from?: string, to?: string, options?: {
    fromUid?: string;
    file?: string;
    fromFile?: string;
    toUid?: string;
    toFile?: string;
    depth?: string;
    repo?: string;
    branch?: string;
    includeTests?: boolean;
}): Promise<void>;
