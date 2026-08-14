/**
 * MCP Stdio Context — AsyncLocalStorage-tagged transport-write detection.
 *
 * The MCP stdio transport writes JSON-RPC frames to stdout. Per spec, the
 * server MUST NOT write anything to stdout that is not a valid MCP message.
 * Stray writes from dependency code corrupt the protocol and present to
 * clients as a hung handshake or `MCP error -32000`.
 *
 * This module provides:
 *   - withMcpWrite(fn): runs fn inside an AsyncLocalStorage context tagged
 *     `mcp: true`. The transport wraps every send() in this so its writes
 *     are recognizable as legitimate.
 *   - isMcpWrite(): true when called inside withMcpWrite.
 *   - createStdoutSentinel({...}): a write function suitable for installing
 *     in a Proxy over process.stdout. Tagged writes pass through to the real
 *     stdout; untagged writes are redirected to stderr with a [mcp:stdout-redirect]
 *     prefix, truncated to maxBytes per redirect, and rate-limited to maxRedirects
 *     per process so a stray loop cannot flood client logs.
 *
 * The sentinel is correctness-by-construction: it identifies legitimate
 * writes by *who* called write(), not by inspecting the bytes. A byte-shape
 * heuristic ("starts with {, ends with \n") would falsely reject Content-Length
 * frames (which start with C and end with }) and misclassify multi-chunk writes.
 */
export declare function withMcpWrite<T>(fn: () => T): T;
export declare function isMcpWrite(): boolean;
type WriteFn = typeof process.stdout.write;
export interface SentinelOptions {
    realStdoutWrite: WriteFn;
    realStderrWrite: WriteFn;
    /** Maximum bytes of payload to surface per redirect. Defaults to 200. */
    maxBytes?: number;
    /** Maximum number of redirects per process before suppression. Defaults to 10. */
    maxRedirects?: number;
}
export interface SentinelStats {
    redirected: number;
    suppressed: number;
}
export interface Sentinel {
    write: WriteFn;
    stats: () => SentinelStats;
    flushSummary: () => void;
}
export declare function createStdoutSentinel(opts: SentinelOptions): Sentinel;
export declare function installGlobalStdoutSentinel(): Sentinel;
export {};
