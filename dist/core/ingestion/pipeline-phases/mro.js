/**
 * Phase: mro
 *
 * Computes Method Resolution Order (MRO) and creates METHOD_OVERRIDES
 * and METHOD_IMPLEMENTS edges.
 *
 * @deps    crossFile, scopeResolution, pruneLocalSymbols
 * @reads   graph (all nodes and relationships)
 * @writes  graph (METHOD_OVERRIDES, METHOD_IMPLEMENTS edges)
 */
import { getPhaseOutput } from './types.js';
import { computeMRO } from '../mro-processor.js';
import { isDev } from '../utils/env.js';
import { logger } from '../../logger.js';
export const mroPhase = {
    name: 'mro',
    deps: ['crossFile', 'scopeResolution', 'pruneLocalSymbols', 'structure'],
    async execute(ctx, deps) {
        const { totalFiles } = getPhaseOutput(deps, 'structure');
        ctx.onProgress({
            phase: 'enriching',
            percent: 98,
            message: 'Computing method resolution order...',
            stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
        });
        const mroResult = computeMRO(ctx.graph);
        if (isDev && mroResult.entries.length > 0) {
            logger.info(`🔀 MRO: ${mroResult.entries.length} classes analyzed, ${mroResult.ambiguityCount} ambiguities, ${mroResult.overrideEdges} METHOD_OVERRIDES, ${mroResult.methodImplementsEdges} METHOD_IMPLEMENTS`);
        }
        return {
            entries: mroResult.entries.length,
            ambiguityCount: mroResult.ambiguityCount,
            overrideEdges: mroResult.overrideEdges,
            methodImplementsEdges: mroResult.methodImplementsEdges,
        };
    },
};
