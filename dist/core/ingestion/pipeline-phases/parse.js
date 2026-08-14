/**
 * Phase: parse
 *
 * Chunked parse + resolve loop: reads source in byte-budget chunks,
 * parses via the worker pool (the sole parse path — no sequential fallback),
 * resolves imports, heritage, and calls, synthesizes wildcard bindings.
 *
 * This phase encapsulates the entire `runChunkedParseAndResolve` function
 * from the original pipeline. The chunk loop is a memory optimization
 * internal to this phase, not a phase boundary.
 *
 * @deps    structure, markdown, cobol
 * @reads   scannedFiles, allPaths, totalFiles (from structure)
 * @writes  graph (Symbol nodes, IMPORTS/CALLS/EXTENDS/IMPLEMENTS/ACCESSES edges)
 * @output  exportedTypeMap, allFetchCalls, allExtractedRoutes, allDecoratorRoutes,
 *          allToolDefs, allORMQueries, bindingAccumulator
 */
import { getPhaseOutput } from './types.js';
import { runChunkedParseAndResolve } from './parse-impl.js';
export const parsePhase = {
    name: 'parse',
    deps: ['structure', 'markdown', 'cobol'],
    async execute(ctx, deps) {
        // Begin streamed structural emit (#2680), if enabled. Deliberately here and
        // not at graph construction: the pre-parse phases are not all write-only —
        // `mapCobolToGraph` scans CALLS edges and removes the unresolved ones — and
        // nothing before parse produces bulk edge volume anyway.
        ctx.graphEmit?.beginStreaming();
        const { scannedFiles, allPaths, allPathSet, totalFiles } = getPhaseOutput(deps, 'structure');
        const result = await runChunkedParseAndResolve(ctx.graph, scannedFiles, allPaths, totalFiles, ctx.repoPath, ctx.pipelineStart, ctx.onProgress, ctx.options);
        return {
            ...result,
            allPaths,
            allPathSet,
            totalFiles,
        };
    },
};
