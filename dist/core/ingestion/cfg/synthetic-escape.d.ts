/**
 * Synthetic-escape pass for CDG soundness (#2197 U1).
 *
 * THE PROBLEM. Control dependence is computed over the post-dominator tree
 * (control-dependence.ts), which is only sound when EXIT is reverse-reachable
 * from every entry-reachable block (post-dominators.ts §
 * {@link isExitReachableFromAllBlocks}). Loop visitors keep that invariant by
 * giving every loop a structural `header → loopExit` `cond-false` edge — so an
 * ordinary `while`/`for` always has a path to EXIT. The `goto` handlers
 * (C/C++/C#/Go), however, wire an UNCONDITIONAL back-edge as plain `seq` with no
 * such escape:
 *
 *   void handler(int a){ start: if (a > 0) { work(); } goto start; }
 *
 * Here every body block sits in a trapping cycle (`start … goto start`) with no
 * path to EXIT, so EXIT is non-reverse-reachable and {@link emitFileCdg} (the
 * soundness gate) WITHHOLDS all control dependence for the whole function —
 * silent CDG coverage loss for an entire (common) class of functions.
 *
 * THE FIX (nontermination-sensitive control dependence — Ranganath et al.,
 * TOPLAS 2007). For a genuinely exit-unreachable *cycle* (an infinite loop), add
 * an ANALYSIS-ONLY virtual escape edge from the cycle's controlling branch to
 * EXIT, making the post-dom tree well-defined again. The synthetic edge is inert
 * in the Ferrante walk (EXIT post-dominates its source, so the post-dom guard
 * skips it) — it only restores reverse-reachability so the REAL control points
 * inside the loop get their dependences.
 *
 * ANALYSIS-ONLY (load-bearing — KTD7). The pass NEVER mutates the input. The
 * persisted CFG / REACHING_DEF graph and the byte-identical-off golden depend on
 * `cfg.edges` staying faithful, so the augmentation lives on a shallow-cloned
 * {@link FunctionCfg} whose `edges` is `[...cfg.edges, ...synthetic]`. Because
 * both {@link computePostDominators} AND {@link computeControlDependence}
 * (its Ferrante walk + `buildArmSenses`) re-read `cfg.edges` directly, the
 * augmented view must be passed to BOTH — feeding only an augmented post-dom
 * tree would leave the walk on the un-augmented edges (KTD7).
 *
 * PURE AND DETERMINISTIC (mirrors post-dominators.ts / reaching-defs.ts). The
 * SCC routine sorts every adjacency list and emits SCCs root-deterministically,
 * so the chosen representative — hence the augmented edge set and any downstream
 * snapshot — is identical across runs.
 *
 * WHICH SCCs ARE BRIDGED (KTD2 / KTD6, and the anti-masking guarantee R2). The
 * decision is gated on the WHOLE entry-reachable trapped region (the union of
 * the entry-reachable blocks that cannot reach EXIT): the pass bridges only when
 * that region contains at least one *control point* — a block with ≥2 successors
 * (a branch terminator). A region with a control point is a real, recoverable
 * loop (a `goto`-cycle always carries the `if` predicate from its guard); a
 * region with NO control point is a branch-less infinite spin that carries no
 * control dependence to recover AND is indistinguishable from a genuine
 * CFG-construction anomaly (e.g. a disconnected EXIT block), so it is
 * deliberately LEFT UNBRIDGED — the existing soundness gate then skips the
 * function and surfaces the skip (R2 / R3). In practice a branch-less trapping
 * region never comes from a real loop visitor (loops emit the structural escape
 * edge) — it signals a construction error, exactly what we must not paper over.
 *
 * When the region is bridged, EACH exit-less SCC gets one synthetic escape edge
 * from its *controlling representative*: the entry-reachable member with a branch
 * terminator (≥2 successors), highest out-degree, lowest-index tie-break. That
 * branch is the predicate deciding stay-in-loop vs. leave, the faithful escape
 * representative; attaching the escape anywhere else invents or drops CDG edges
 * while still passing the AC2 post-dominance property test, so the choice is
 * pinned by an exact-edge-set test, not `CDG>0`. When an exit-less SCC has NO
 * internal branch (e.g. the body of an irreducible loop whose control point sits
 * OUTSIDE the cycle), its escape attaches to the lowest-index member — the
 * choice is semantically immaterial (the SCC has no internal control point so it
 * contributes no internal CDG), and a deterministic index keeps snapshots
 * stable. This per-SCC bridging restores reverse-reachability for the whole
 * region in one batch, then the gate re-checks (KTD2).
 *
 * GRANULARITY OF A MIXED cycle + dead-end FUNCTION. {@link emitFileCdg} is
 * all-or-nothing per function: it computes CDG only when EXIT is reverse-
 * reachable from EVERY entry-reachable block. So if a function contains a
 * recoverable goto-cycle AND a *separate* residual block that is still
 * exit-unreachable after all escapes (a dangling/dead-end block not in any
 * bridgeable cycle), the pass restores the cycle but the residual block keeps
 * EXIT non-reverse-reachable → the WHOLE function is still skipped and surfaced.
 * We do NOT bridge the residual (that would mask the construction error), and we
 * do NOT emit partial per-cycle CDG (the emit layer has no partial mode). This
 * is the documented, intentional trade-off: recover the common goto-cycle case;
 * surface anything with a genuine residual anomaly rather than guess.
 */
import { isExitReachableFromAllBlocks, type PostDomTree } from './post-dominators.js';
import type { FunctionCfg } from './types.js';
/**
 * Strongly-connected components of a CFG via an ITERATIVE Tarjan over the
 * forward edges. Pure and deterministic: nodes are visited in ascending index
 * and every successor list is iterated in sorted order, so the component
 * partition (and the per-component member order) is identical across runs.
 *
 * Returns `compOf[b]` = the component id of block `b`, plus `members[c]` = the
 * (ascending-index) members of component `c`. Component ids are assigned in
 * Tarjan completion order (a reverse-topological order over the condensation),
 * which is deterministic but not relied upon — callers key on `compOf`.
 */
export interface SccResult {
    readonly compOf: readonly number[];
    readonly members: readonly (readonly number[])[];
}
export declare function computeScc(succ: readonly number[][], n: number): SccResult;
/**
 * Restore EXIT reverse-reachability for genuine exit-unreachable cycles so the
 * post-dom / CDG pass runs on a well-defined tree, WITHOUT masking construction
 * errors or perturbing sound functions. See the module doc for the full
 * contract.
 *
 * Returns the input `cfg` UNCHANGED (referential no-op) when EXIT is already
 * reverse-reachable from every entry-reachable block — terminating functions and
 * properly-escaped loops are byte-identical (zero synthetic edges). Otherwise
 * returns a SHALLOW-CLONED {@link FunctionCfg} whose `edges` is the original
 * edges followed by the synthetic escapes; the input's `edges` is never mutated.
 *
 * Pass the returned view to BOTH {@link computePostDominators} and
 * {@link computeControlDependence} (KTD7).
 */
export declare function augmentForPostDom(cfg: FunctionCfg): FunctionCfg;
/**
 * Convenience: `true` iff {@link augmentForPostDom} returned a DIFFERENT object
 * (i.e. at least one synthetic escape edge was added). Useful for tests
 * asserting the no-op path. Reference equality is exact: the no-op path returns
 * the input unchanged.
 */
export declare function wasAugmented(cfg: FunctionCfg, view: FunctionCfg): boolean;
export { isExitReachableFromAllBlocks };
export type { PostDomTree };
