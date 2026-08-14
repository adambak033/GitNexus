/**
 * Interprocedural taint fixpoint (#2084 M4 U3).
 *
 * Composes per-function {@link FunctionSummary} objects over the resolved
 * `CALLS` graph to find source→sink flows that cross function and file
 * boundaries. PURE AND DETERMINISTIC (no graph, no I/O, no logger) — the phase
 * builds the inputs from `ctx.graph` and persists the outputs.
 *
 * ## The model — whole-parameter taint reachability
 *
 * The unit of taint is `(function, parameter)`. The fixpoint computes the set
 * of parameters that can hold source-derived data, then fires a finding
 * whenever a tainted parameter feeds a modelled sink (`paramToSink`).
 *
 * - **Seeds** — every `sourceToCallArg` edge: a function generates a source and
 *   passes it into argument `argIndex` of a call at `callLine`. Resolving that
 *   call site against the caller's outgoing `CALLS` edges yields the callee;
 *   the callee's parameter `argIndex` becomes tainted, with the generating
 *   function recorded as the flow's source.
 * - **Propagation** — every `paramToCallArg` edge of a function whose parameter
 *   is ALREADY tainted: `param i → arg j of callee` taints the callee's
 *   parameter `j` (TITO composition). Iterated to a fixpoint.
 * - **Findings** — whenever a parameter becomes tainted and the owning
 *   function's `paramToSink` contains that parameter, a cross-function finding
 *   is emitted (source function → sink function, with the kind).
 *
 * ## Cycle safety (recursion)
 *
 * The tainted-parameter set is monotone over a FINITE lattice (`Σ functions ×
 * params`), so the worklist fixpoint converges: a recursive or mutually
 * recursive call merely re-proposes an already-tainted parameter, which the
 * visited-set absorbs — no infinite descent. This is the functional/summary
 * method's standard termination argument (Sharir-Pnueli; Pysa, Mariana Trench,
 * and Infer all rely on it). SCC condensation would only refine the PROCESSING
 * ORDER; correctness and termination do not require it.
 *
 * ## Context-insensitivity & the name-join over-approximation
 *
 * One summary per function, applied at every call site — return/param merging
 * is accepted (the security-conservative direction). The call-arg→callee join
 * is by callee NAME (not line), so when one caller invokes two DISTINCT
 * same-named callees (`x.handler(src)` and `y.handler(clean)`), a source that
 * flowed into ONE of them taints BOTH callees' parameter — an extra finding on
 * the callee the source did not reach. This is sound (over-attribution, never a
 * missed flow — the conservative direction for a security tool) and is the
 * documented price of dropping the fragile line-based join; the `explain` tool
 * surfaces it ("may over-attribute among same-named callees"). Other known
 * precision losses (call-site conflation, shared dispatch, callbacks) are the
 * documented M4 trade-offs; refinements are deferred (plan KTD).
 */
import type { SinkKind } from './source-sink-config.js';
import type { FunctionSummary } from './summary-model.js';
/**
 * One resolved call edge from the `CALLS` graph. The join to a summary's
 * call-arg edge is by CALLEE NAME (the callee node's declared name), NOT by
 * call-site line — line-base parity between the CFG harvest (1-based) and the
 * reference site is fragile, while the callee identity is exact and the
 * context-insensitive model tatints the callee's parameter the same way at
 * every call site to it.
 */
export interface InterprocCallEdge {
    readonly callerId: string;
    readonly calleeId: string;
    /** The callee node's declared name (`helper`, `process`) — the join key. */
    readonly calleeName: string;
}
/** One hop of a cross-function flow: the function entered, and how. */
export interface InterprocHop {
    readonly fnId: string;
    /** The call-site line in the PREVIOUS function that entered this one. */
    readonly callLine?: number;
    /** Argument position the taint entered through (undefined for the source fn). */
    readonly argIndex?: number;
}
export interface InterprocFinding {
    readonly sourceFnId: string;
    readonly sinkFnId: string;
    readonly sinkKind: SinkKind;
    /** Ordered source→sink hop chain (functions). A prefix when `truncated`. */
    readonly hops: readonly InterprocHop[];
    readonly hopsTruncated: boolean;
}
export interface InterprocLimits {
    /** Max functions in a single flow's hop chain. `undefined`/0 ⇒ default 32. */
    readonly maxHops?: number;
    /** Max findings overall (post-dedup). `undefined`/0 ⇒ unlimited. */
    readonly maxFindings?: number;
}
export interface InterprocResult {
    readonly findings: readonly InterprocFinding[];
    /** Findings dropped by `maxFindings` (post-dedup). */
    readonly droppedFindings: number;
    /** Call edges whose call-site line matched no summary edge (diagnostics). */
    readonly unmatchedCallSites: number;
}
export declare const DEFAULT_MAX_INTERPROC_HOPS = 32;
/**
 * Default per-run cap on cross-function findings (#2084 review P1-3). Like the
 * other pdg caps it is resolved into `RepoMeta.pdg` so `pdgModeMismatch`
 * stamps it; `0` ⇒ unlimited. 2000 is generous for a real repo — more deduped
 * `(source, sink, kind)` findings than that is a fixture or a runaway fan-in,
 * and the overflow is deterministic + counted (`droppedFindings`).
 */
export declare const DEFAULT_PDG_MAX_INTERPROC_FINDINGS = 2000;
/**
 * Run the interprocedural taint fixpoint. `summaries` is keyed by function node
 * id; `callEdges` is the resolved `CALLS` graph (caller→callee with call-site
 * lines). Deterministic: inputs in, sorted findings out.
 */
export declare function solveInterprocTaint(summaries: ReadonlyMap<string, FunctionSummary>, callEdges: readonly InterprocCallEdge[], limits?: InterprocLimits): InterprocResult;
