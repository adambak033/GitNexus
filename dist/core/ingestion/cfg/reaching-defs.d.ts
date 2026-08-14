/**
 * Reaching definitions (#2082 M2 U3, SSA-sparse rewrite #2201) — per-function
 * intraprocedural may-reaching-definitions, plus the canonical intra-block
 * statement sweep that recovers statement-granular def→use facts from M1's
 * coalesced blocks WITHOUT re-splitting the CFG.
 *
 * ARCHITECTURE (#2201): the analysis is split into solver-INDEPENDENT stages
 * (shared by every path, so the byte-identical surface is maximal) and a
 * swappable IN-set computation:
 *   - {@link harvestStatementFacts} — per-block GEN/allDefs + def/use telemetry.
 *   - {@link buildAdjacency} — throw-aware predecessor/successor adjacency.
 *   - the IN-set computer — answers block-entry reaching-set queries. Two
 *     implementations: {@link computeInSetsSparse} (SSA — CHK dominators →
 *     Cytron dominance frontiers + φ-placement → stack renaming over a
 *     synthetic entry, walked SCC-condensed) and {@link computeInSetsDense}
 *     (the original GEN/KILL worklist). Production runs {@link
 *     computeInSetsAuto}, which picks the SSA solver for looping functions large
 *     enough to amortize construction (where it is asymptotically faster and
 *     never hits the dense ceiling) and the dense worklist everywhere else; the
 *     dense path also serves the throw-edge / unreachable-block cases the SSA
 *     path does not model. The two are held byte-identical by the equivalence
 *     fuzz — only set CONTENTS must match (the sweep sorts each use's keys
 *     before the maxFacts cutoff, so iteration order is irrelevant).
 *   - {@link sweepFacts} — statement sweep + sort + maxFacts truncation.
 *
 * PURE AND DETERMINISTIC (load-bearing contract):
 *  - Pure function of its inputs — no graph, no logger (warnings are the
 *    caller's job), importable outside the worker. The M3 taint engine calls
 *    this same function in-phase (facts are recomputed on demand, never
 *    retained run-wide — the persisted REACHING_DEF edges are a bounded
 *    projection, never the taint substrate).
 *  - Deterministic — predecessors merge in sorted block-index order,
 *    insertion-ordered Maps/Sets throughout, and the output fact array is
 *    explicitly sorted. Snapshot tests and content-derived edge ids rely on it.
 *
 * COMPLEXITY DISCIPLINE: def-sets are SHARED BY REFERENCE, never deep-copied —
 * a MUST def's kill is total per binding, so a transfer either aliases the
 * incoming set or replaces it; a MAY def (conditional context — see
 * StatementFacts.mayDefs) unions WITHOUT killing via a copy-on-extend.
 *
 * `limits.maxFacts` bounds materialization: facts are O(defs×uses) BY SPEC in
 * merge-heavy code (N branch-arm defs × N later uses = N² facts), and a
 * 2000-line function can spike 100k+ fact objects on the main thread. The
 * emit path passes DEFAULT_PDG_MAX_REACHING_DEF_FACTS_PER_FUNCTION (emit.ts);
 * M3 passes its own large-but-finite limit and treats `status: 'truncated'`
 * as a per-function taint-coverage gap.
 */
import type { BindingEntry, FunctionCfg } from './types.js';
/** A statement-granular program point within one function's CFG. */
export interface ProgramPoint {
    readonly blockIndex: number;
    /** Statement index within the block's `statements` array. */
    readonly stmtIndex: number;
    readonly line: number;
}
/**
 * Canonical `block:stmt` string key for a program point. Colon-separated to
 * match the codebase's `blockIndex:stmtIndex` id conventions. Shared by the
 * taint propagation engine (dedup/state keys) and the taint emit path
 * (persisted edge-id material) so the two never drift.
 */
export declare function pointKey(p: ProgramPoint): string;
/** One def→use fact: the definition at `def` reaches the use at `use`. */
export interface DefUseFact {
    /** Index into {@link FunctionDefUse.bindings}. */
    readonly bindingIdx: number;
    readonly def: ProgramPoint;
    readonly use: ProgramPoint;
}
export interface ReachingDefsLimits {
    /**
     * Maximum number of facts to materialize; the sweep stops early and reports
     * `status: 'truncated'`. `undefined`/0 ⇒ unlimited.
     */
    readonly maxFacts?: number;
    /**
     * Adversarial-only safety bound on the DENSE worklist's iteration.
     *
     * The dense GEN/KILL solver reads this as a ceiling on total block dequeues:
     * iterative reaching-defs on a reducible CFG converges in O(loop-nesting-depth)
     * passes, but a pathologically deep loop nest drives the visit total — and thus
     * the solver — to O(blocks²), seconds + GB of heap (`maxFacts` does not help:
     * fact count stays linear). Exceeding the budget means the fixpoint has NOT
     * converged, so any facts would be unsound — the dense solver bails to a sound
     * empty `status: 'truncated'` (like the `overflow` guard).
     *
     * The SSA solver (#2201) has NO fixpoint iteration — it answers reaching
     * queries from the def-use graph in one pass — so it always converges and this
     * budget never trips it. The production dispatcher ({@link computeInSetsAuto})
     * routes the deep nests that would breach the dense ceiling to the SSA solver,
     * which computes their full facts: the ceiling that fired on the dense worklist
     * effectively never fires on real code (#2201 acceptance). The budget is still
     * honored on the dense fallback path (small / loop-free functions, and the
     * throw-edge / unreachable-block cases the SSA path does not model).
     *
     * `undefined`/0 ⇒ unlimited (the default for direct callers; the emit path sets
     * a per-function budget).
     */
    readonly maxBlockVisits?: number;
    /**
     * Memory bound on the SSA-sparse solver's value-graph construction (#2201
     * review R1). `maxFacts` bounds fact MATERIALIZATION (sweepFacts) but nothing
     * bounds the φ/value-graph the sparse path builds first; a high-binding-density
     * deep loop routed to SSA (≥ SSA_MIN_BLOCKS blocks + a reachable loop) builds an
     * O(blocks×bindings) graph the dense path would have truncated at the
     * `maxBlockVisits` ceiling (~1.5 GB measured on a 3000-block × 300-binding
     * function). When the projected node count would exceed this, the sparse solver
     * falls back to the dense oracle (byte-identical, and bounded — dense honors
     * `maxBlockVisits`). Honored ONLY by the sparse path; the dense solver ignores
     * it. `undefined`/0 ⇒ {@link DEFAULT_MAX_SSA_VALUE_GRAPH_NODES}.
     */
    readonly maxSsaValueGraphNodes?: number;
}
export interface FunctionDefUse {
    /**
     * `computed`  — full facts.
     * `no-facts`  — the CFG carries no statement facts (hand-built or pre-M2
     *               side channel); empty facts, NOT an error.
     * `truncated` — `limits.maxFacts` hit; `facts` is a deterministic prefix.
     * `overflow`  — a block's statement count breaches the def-key stride; no
     *               facts at all (computing any would risk key aliasing —
     *               wrong-block facts are strictly worse than none). Distinct
     *               from `truncated` so the caller's diagnostic doesn't
     *               misname it as the fact-materialization limit.
     */
    readonly status: 'computed' | 'no-facts' | 'truncated' | 'overflow';
    /** Pass-through of the CFG's binding table (empty for `no-facts`). */
    readonly bindings: readonly BindingEntry[];
    /** Sorted by (def block, def stmt, use block, use stmt, binding). */
    readonly facts: readonly DefUseFact[];
    /** Total def / use sites seen (telemetry; independent of truncation). */
    readonly defCount: number;
    readonly useCount: number;
}
/**
 * Compute reaching definitions for one function. See the module doc for the
 * purity/determinism/sharing contract.
 *
 * This is the production entry point. As of #2201 it auto-dispatches via
 * {@link computeInSetsAuto} — the SSA-sparse solver ({@link computeInSetsSparse})
 * for looping functions large enough to amortize construction, the dense
 * GEN/KILL worklist ({@link computeInSetsDense}) everywhere else (and for the
 * throw-edge / unreachable-block functions the SSA path does not model). The two
 * solvers are held byte-identical by the equivalence fuzz (status, bindings,
 * sorted facts, def/use telemetry), so the dispatch is a pure performance
 * heuristic; the dense solver doubles as that differential oracle.
 */
export declare function computeReachingDefs(cfg: FunctionCfg, limits?: ReachingDefsLimits): FunctionDefUse;
/** A reaching-defs solver — {@link computeReachingDefs} or a memoized wrapper. */
export type ReachingDefsSolver = (cfg: FunctionCfg, limits?: ReachingDefsLimits) => FunctionDefUse;
/**
 * Per-file memoized reaching-defs solver (#2227 tri-review, U12). Under `--pdg`
 * the SAME per-function RD fixpoint was solved 3–4× per analyze (RD emit +
 * call-summary harvest + taint + summary harvest). Cache by (cfg identity,
 * limits) so each DISTINCT solve runs once: the RD-emit bucket (passes
 * `maxBlockVisits`) and the harvest/taint bucket (does not) stay byte-identical
 * to their inline solves because the limits are part of the key. Lazy — solves
 * on first request, so the taint zero-match fast path still skips its solve.
 * Create one per FILE and drop it after the file to bound the per-function
 * `facts` arrays (100k+ objects on a huge function) from going whole-repo.
 */
export declare function createMemoizedReachingDefs(): ReachingDefsSolver;
