/**
 * Per-function taint SUMMARY harvest (#2084 M4 U1).
 *
 * Pure, deterministic derivation of one function's {@link FunctionSummary}
 * facts from the SAME substrate the M3 intra-procedural pass consumes — the M2
 * reaching-definition facts (`computeReachingDefs`) and the matched taint sites
 * (`matchFunctionSites`). No graph, no I/O, no logger; mirrors the
 * `computeReachingDefs` / `computeTaintFlows` contract (insertion-ordered
 * worklist, explicitly sorted outputs) so snapshot tests and the version stamp
 * stay stable. Runs IN-PHASE inside the scope-resolution pdg window where the
 * CFG side channel is live (plan KTD1); the cross-function fixpoint that
 * COMPOSES these summaries runs afterward over the complete call graph.
 *
 * ## What a summary captures (whole-parameter granularity)
 *
 * Seeding each formal parameter as taint and running forward reachability over
 * the def→use facts yields four edge categories:
 *
 * - **param→return** — a param's value reaches a `return <expr>`. Return
 *   statements are identified structurally: the SOURCE block of every CFG edge
 *   of kind `return` terminates in the return jump (the M2 edge-kind
 *   invariant), so its last statement's `uses` are the returned bindings.
 * - **param→callee-arg** — a param occurrence lands in argument position
 *   `argIndex` of a call at `callLine`. The fixpoint resolves `callLine` to a
 *   callee via the caller's `CALLS` edges and applies the callee's summary
 *   (TITO composition).
 * - **param→sink** — a param reaches a modelled sink position (the partial
 *   flow that a cross-function source completes).
 * - **source→return** — a modelled source read (`req.body`) reaches the return
 *   (a generative summary: calling the function yields tainted data).
 *
 * ## Soundness model (context-insensitive first cut)
 *
 * Onward propagation uses the M3 STATEMENT-LEVEL precision floor: a statement
 * that uses a tainted binding taints all of its defs (and `mayDefs`). This is
 * the same sound over-approximation M3 documents — it may over-taint
 * (multi-declarator conflation) but never drops a real flow. Sanitizer
 * `resultDefs` narrow the EXCLUSION set (a def produced by a matched sanitizer
 * carries that sanitizer's neutralised `SinkKind`s), so a sanitised value does
 * not trigger a downstream sink of the neutralised kind — the kind-set
 * exclusion model, simplified to the result-def channel (occurrence
 * interposition, field paths, and callbacks are deferred — plan KTD).
 *
 * The summary edges themselves (return / call-arg / sink) are recorded from
 * ACTUAL binding occurrences (a tainted binding present in a return's uses, a
 * call's arg list, or a matched sink position), never the floor — the floor
 * governs only onward def-tainting, keeping the recorded edges precise.
 *
 * ## Known limitation — destructured / rest params (documented FN)
 *
 * Param indices are assigned by ORDINAL over the flattened param-binding list,
 * which equals the FORMAL parameter position only when every param is a simple
 * identifier. A destructured or rest param contributes several bindings (or
 * shifts the count), so a simple param positioned AFTER one
 * (`function f([a, b], x) { sink(x) }`) gets a summary port index that does not
 * match the formal argument position the interprocedural solver joins against
 * — a cross-function false negative for that function. The precise fix needs a
 * formal-param index threaded from the worker harvest (`BindingEntry`), a
 * cache-namespace-affecting change deferred with the other documented FN
 * classes (closures, fields — see the taint skill). Functions with all-simple
 * params (the common case) are unaffected.
 */
import type { FunctionCfg } from '../cfg/types.js';
import { type FunctionDefUse } from '../cfg/reaching-defs.js';
import type { FunctionSiteMatches } from './match.js';
import type { CallResult, ParamToCallArg, ParamToReturn, ParamToSink, SourceToCallArg, SourceToReturn } from './summary-model.js';
/** The own-facts portion of a summary (fnId/version are added by the caller). */
export interface HarvestedSummaryFacts {
    readonly paramCount: number;
    readonly paramToReturn: readonly ParamToReturn[];
    readonly paramToCallArg: readonly ParamToCallArg[];
    readonly paramToSink: readonly ParamToSink[];
    readonly sourceToReturn: readonly SourceToReturn[];
    readonly sourceToCallArg: readonly SourceToCallArg[];
    readonly callResults: readonly CallResult[];
}
export interface HarvestResult {
    /** `computed` — facts derived; `coverage-gap` — the RD solver was not
     *  `computed`, so no summary is produced (consistent with M3 R4). */
    readonly status: 'computed' | 'coverage-gap';
    readonly gapReason?: FunctionDefUse['status'];
    readonly facts: HarvestedSummaryFacts;
}
/**
 * Harvest the summary facts for one function. PRECONDITION: `cfg` is
 * `isEmitSafeCfg`-filtered and `defUse` was computed from it; sites are assumed
 * `hasTaintSafeSites`-valid (the caller gates exactly as the M3 emit path does).
 */
export declare function harvestFunctionSummary(cfg: FunctionCfg, defUse: FunctionDefUse, matches: FunctionSiteMatches): HarvestResult;
