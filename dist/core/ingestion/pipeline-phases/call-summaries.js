/**
 * Phase: callSummaries (PDG FU-C, U-C3)
 *
 * The whole-program CALL_SUMMARY materialisation pass — the dependence-engine
 * SIBLING of `taintSummaries`. Runs AFTER scope-resolution (where the resolved
 * `CALLS` graph lives in `ctx.graph` and the per-function RETURN-VALUE ASCENT
 * summaries were harvested in-phase) and emits one `CALL_SUMMARY` self-loop edge
 * per harvested callee. A later consumer phase (NOT this task) decodes the
 * bitset to ascend a callee's return effect into the caller continuation.
 *
 * Opt-in: registered with `enabledWhen: (o) => o.pdg === true`. A default
 * `analyze` run never includes it, so the graph is byte-identical and emits ZERO
 * CALL_SUMMARY edges. No always-on phase depends on it.
 *
 * @deps    scopeResolution, pruneLocalSymbols
 * @reads   scopeResolution output (callSummaries)
 * @writes  graph (CALL_SUMMARY self-loop edges)
 */
import { getPhaseOutput } from './types.js';
import { emitCallSummaries, DEFAULT_PDG_MAX_CALL_SUMMARY_EDGES, } from '../taint/call-summary-emit.js';
import { logger } from '../../logger.js';
const EMPTY = { summaries: 0, edgesEmitted: 0 };
export const callSummariesPhase = {
    name: 'callSummaries',
    deps: ['scopeResolution', 'pruneLocalSymbols'],
    async execute(ctx, deps) {
        const scope = getPhaseOutput(deps, 'scopeResolution');
        const summaries = scope.callSummaries;
        if (summaries.length === 0)
            return EMPTY;
        const maxEdges = ctx.options?.pdgMaxCallSummaryEdges ?? DEFAULT_PDG_MAX_CALL_SUMMARY_EDGES;
        const emit = emitCallSummaries(ctx.graph, summaries, { maxEdges }, (m) => logger.warn(m));
        if (emit.edgesDropped > 0) {
            logger.warn(`[call-summary] capped: ${emit.edgesDropped} CALL_SUMMARY edge(s) dropped by the ` +
                `per-run cap (${maxEdges}) — raise pdgMaxCallSummaryEdges if intentional`);
        }
        if (emit.skippedMissingEndpoint > 0) {
            logger.debug(`[call-summary] ${emit.skippedMissingEndpoint} summary/summaries skipped (callee node ` +
                `missing from graph)`);
        }
        if (emit.edgesEmitted > 0) {
            logger.debug(`[call-summary] ${summaries.length} summaries → ${emit.edgesEmitted} CALL_SUMMARY edge(s)`);
        }
        return { summaries: summaries.length, edgesEmitted: emit.edgesEmitted };
    },
};
