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
import type { PipelinePhase } from './types.js';
export interface CallSummariesOutput {
    /** Per-callee summaries fed to the emit. */
    summaries: number;
    /** CALL_SUMMARY edges persisted. */
    edgesEmitted: number;
}
export declare const callSummariesPhase: PipelinePhase<CallSummariesOutput>;
