/**
 * Phase: structure
 *
 * Builds File and Folder nodes in the graph from scanned paths.
 *
 * @deps    scan
 * @reads   allPaths (from scan phase)
 * @writes  graph (File, Folder nodes + CONTAINS edges)
 */
import { getPhaseOutput } from './types.js';
import { processStructure } from '../structure-processor.js';
export const structurePhase = {
    name: 'structure',
    deps: ['scan'],
    async execute(ctx, deps) {
        const { scannedFiles, allPaths, totalFiles } = getPhaseOutput(deps, 'scan');
        ctx.onProgress({
            phase: 'structure',
            percent: 15,
            message: 'Analyzing project structure...',
            stats: { filesProcessed: 0, totalFiles, nodesCreated: ctx.graph.nodeCount },
        });
        processStructure(ctx.graph, allPaths);
        ctx.onProgress({
            phase: 'structure',
            percent: 20,
            message: 'Project structure analyzed',
            stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
        });
        // Build the set once here so cobol, markdown, and cross-file propagation
        // can all reuse it instead of re-materializing `new Set(allPaths)` each.
        const allPathSet = new Set(allPaths);
        return { scannedFiles, allPaths, allPathSet, totalFiles };
    },
};
