/**
 * Project an `AnalyzeResult` down to the JSON-safe fields the parent consumes,
 * dropping `pipelineResult` (the live `KnowledgeGraph`) and any other field not
 * in the `AnalyzeResultIpc` allowlist. The return literal is exhaustive over
 * `AnalyzeResultIpc` (a missing key is a compile error).
 */
export function projectAnalyzeResultForIpc(result) {
    return {
        repoName: result.repoName,
        repoPath: result.repoPath,
        stats: result.stats,
        alreadyUpToDate: result.alreadyUpToDate,
        ftsRepairedOnly: result.ftsRepairedOnly,
        ftsSkipped: result.ftsSkipped,
        // Carried across IPC so a server-side caller sees the same degraded
        // outcome the CLI does; without it the worker reports a clean `complete`
        // for a run whose edges are mostly missing.
        graphWriteCollapsed: result.graphWriteCollapsed,
    };
}
