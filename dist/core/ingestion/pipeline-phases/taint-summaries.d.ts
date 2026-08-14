/**
 * Phase: taintSummaries (#2084 M4 U3/U5)
 *
 * The interprocedural taint fixpoint. Runs AFTER scope-resolution (where the
 * complete, resolved `CALLS` graph lives in `ctx.graph` and the per-function
 * summaries were harvested in-phase) and composes those summaries to find
 * source→sink flows that cross function and file boundaries.
 *
 * Opt-in: registered with `enabledWhen: (o) => o.pdg === true` (the first real
 * pdg-gated phase). A default `analyze` run never includes it, so the graph is
 * byte-identical. No always-on phase depends on it (a filtered-out dep would
 * throw in `getPhaseOutput`).
 *
 * @deps    scopeResolution, pruneLocalSymbols
 * @reads   graph (CALLS edges, Function/Method nodes), scopeResolution output
 *          (functionSummaries)
 * @writes  graph (TAINT_PATH edges)
 */
import type { PipelinePhase } from './types.js';
export interface TaintSummariesOutput {
    /** Function summaries fed to the fixpoint. */
    summaries: number;
    /** Cross-function findings (pre-cap). */
    findings: number;
    /** TAINT_PATH edges persisted. */
    edgesEmitted: number;
    /** Call sites whose callee did not resolve to a summary edge (diagnostics). */
    unmatchedCallSites: number;
}
export declare const taintSummariesPhase: PipelinePhase<TaintSummariesOutput>;
