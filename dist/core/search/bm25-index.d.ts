/**
 * Full-Text Search via LadybugDB FTS
 *
 * Uses LadybugDB's built-in full-text search indexes for keyword-based search.
 * Always reads from the database (no cached state to drift).
 */
export interface BM25SearchResult {
    filePath: string;
    score: number;
    rank: number;
    nodeIds?: string[];
}
export interface FTSSearchResponse {
    results: BM25SearchResult[];
    /** True when at least one FTS index query succeeded (index exists). */
    ftsAvailable: boolean;
    /**
     * Redacted (via {@link redactPaths}) message(s) from per-table
     * `QUERY_FTS_INDEX` calls that failed for a reason OTHER than "index
     * doesn't exist" (#2767) — a real query/connection error was previously
     * indistinguishable from a genuinely-missing index. Populated whenever ANY
     * table hit a non-benign error, regardless of whether other tables
     * succeeded, so a caller can always log it; whether to also surface it in
     * a client-facing warning is a caller decision (see `LocalBackend.query()`,
     * which only does so when every table failed).
     */
    nonBenignErrors?: string[];
}
/**
 * Search using LadybugDB's built-in FTS (always fresh, reads from disk)
 *
 * Queries multiple node tables (File, Function, Class, Method) in parallel
 * and merges results by filePath, summing scores for the same file.
 *
 * @param query - Search query string
 * @param limit - Maximum results
 * @param repoId - If provided, queries will be routed via the MCP connection pool
 * @returns Ranked search results from FTS indexes
 */
export declare const searchFTSFromLbug: (query: string, limit?: number, repoId?: string) => Promise<FTSSearchResponse>;
