/**
 * Phase: communities
 *
 * Detects code communities via Leiden algorithm and creates
 * Community nodes + MEMBER_OF edges.
 *
 * @deps    mro, pruneLocalSymbols
 * @reads   graph (all nodes and relationships)
 * @writes  graph (Community nodes, MEMBER_OF edges)
 */
import { getPhaseOutput } from './types.js';
import { processCommunities } from '../community-processor.js';
import { isDev } from '../utils/env.js';
import { logger } from '../../logger.js';
export const communitiesPhase = {
    name: 'communities',
    // `pruneLocalSymbols` is declared explicitly (not just transitively via `mro`)
    // so community detection always reads the trimmed graph even if a future option
    // drops `mro` from the phase list.
    deps: ['mro', 'pruneLocalSymbols', 'structure'],
    async execute(ctx, deps) {
        const { totalFiles } = getPhaseOutput(deps, 'structure');
        ctx.onProgress({
            phase: 'communities',
            percent: 98,
            message: 'Detecting code communities...',
            stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
        });
        const communityResult = await processCommunities(ctx.graph, (message, progress) => {
            const communityProgress = 98 + progress * 0.01;
            ctx.onProgress({
                phase: 'communities',
                percent: Math.round(communityProgress),
                message,
                stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
            });
        });
        if (isDev) {
            logger.info(`🏘️ Community detection: ${communityResult.stats.totalCommunities} communities found (modularity: ${communityResult.stats.modularity.toFixed(3)})`);
        }
        communityResult.communities.forEach((comm) => {
            ctx.graph.addNode({
                id: comm.id,
                label: 'Community',
                properties: {
                    name: comm.label,
                    filePath: '',
                    heuristicLabel: comm.heuristicLabel,
                    cohesion: comm.cohesion,
                    symbolCount: comm.symbolCount,
                },
            });
        });
        communityResult.memberships.forEach((membership) => {
            ctx.graph.addRelationship({
                id: `${membership.nodeId}_member_of_${membership.communityId}`,
                type: 'MEMBER_OF',
                sourceId: membership.nodeId,
                targetId: membership.communityId,
                confidence: 1.0,
                reason: 'leiden-algorithm',
            });
        });
        return { communityResult };
    },
};
