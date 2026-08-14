/**
 * Phase: pruneLocalSymbols
 *
 * Drops inert function/block-local value symbols after scope resolution has
 * already used them for binding and call resolution.
 *
 * @deps    scopeResolution
 * @reads   graph (nodes and relationships)
 * @writes  graph (removes unreferenced local Const/Variable/Static nodes)
 */
import { pruneLocalValueSymbols } from '../local-symbol-pruner.js';
import { isDev } from '../utils/env.js';
import { logger } from '../../logger.js';
export const pruneLocalSymbolsPhase = {
    name: 'pruneLocalSymbols',
    deps: ['scopeResolution'],
    async execute(ctx) {
        const stats = pruneLocalValueSymbols(ctx.graph, {
            keepLocalValueSymbols: ctx.options?.keepLocalValueSymbols,
        });
        if (isDev && !stats.skippedByEnv && stats.prunedNodes > 0) {
            logger.info(`Pruned ${stats.prunedNodes}/${stats.candidateNodes} inert local value symbols`);
        }
        return stats;
    },
};
