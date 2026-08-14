/**
 * Post-dominators (#2085 M5 U2) — the immediate-post-dominator tree of one
 * function's CFG, the substrate the Ferrante control-dependence pass walks.
 *
 * A block `p` post-dominates a block `b` iff every path from `b` to the
 * function EXIT passes through `p`. Post-dominators are exactly the DOMINATORS
 * of the REVERSE CFG rooted at EXIT, so this is the Cooper–Harvey–Kennedy
 * "A Simple, Fast Dominance Algorithm" run over reversed edges. KTD2 of the M5
 * plan picks CHK over Lengauer–Tarjan: per-function CFGs are small and
 * line-capped, CHK is near-linear in practice, and its iterative shape matches
 * the reaching-defs fixpoint already in this module.
 *
 * PURE AND DETERMINISTIC (load-bearing, mirrors reaching-defs.ts): no graph, no
 * logger, importable outside the worker; predecessors/successors are sorted and
 * iteration is reverse-postorder so the `ipdom` array is identical across runs
 * (snapshot tests and content-derived edge ids depend on it).
 *
 * The single-EXIT invariant the M1 TS visitor preserves (visitors/typescript.ts)
 * makes EXIT the unique reverse-CFG root. Blocks that cannot reach EXIT in the
 * forward CFG (an exit-less infinite loop) are not reverse-reachable from it and
 * have NO post-dominator: their `ipdom` is {@link NO_IPDOM}. The control-
 * dependence pass treats "no post-dominator" as "does not post-dominate" (KTD5).
 *
 * NOTE (issue #2188 F2): this is NOT a fully sound over-approximation. Inside a
 * region where NO block reaches EXIT, every `ipdom` is `NO_IPDOM`, so the
 * Ferrante walk degenerates to one edge per control point — it can both DROP a
 * real control dependence and INVENT a spurious one. This does not arise for the
 * current TS visitor (every loop is given a structural `header → loopExit`
 * `cond-false` edge, so EXIT stays reverse-reachable), but it is unsound for
 * hand-built CFGs and any future language visitor lacking that exit edge.
 * Nontermination-sensitive post-dominance (a virtual root over the
 * non-terminating SCCs) would be the correct treatment — tracked for follow-up.
 */
import type { FunctionCfg } from './types.js';
/**
 * Sentinel `ipdom` value: the block has no immediate post-dominator. True for
 * the EXIT block itself (the reverse-CFG root) and for any block that cannot
 * reach EXIT. Chosen as -1 so the {@link postDominates} climb terminates
 * naturally instead of self-looping on the root.
 */
export declare const NO_IPDOM = -1;
export interface PostDomTree {
    /**
     * `ipdom[b]` = the index of `b`'s immediate post-dominator, or
     * {@link NO_IPDOM} when `b` has none (EXIT, or a block that cannot reach EXIT).
     */
    readonly ipdom: readonly number[];
}
/**
 * Compute the immediate-post-dominator tree for one function's CFG. See the
 * module doc for the purity/determinism contract and EXIT-root assumptions.
 */
export declare function computePostDominators(cfg: FunctionCfg): PostDomTree;
/**
 * Does block `p` post-dominate block `b`? Climbs the post-dom tree from `b`
 * toward EXIT and tests membership of `p`. Reflexive: a block post-dominates
 * itself. A block with no post-dominator (EXIT, or one that cannot reach EXIT)
 * is post-dominated only by itself. The step guard is purely defensive — the
 * `ipdom` chain is a tree and always terminates at {@link NO_IPDOM}.
 */
export declare function postDominates(tree: PostDomTree, p: number, b: number): boolean;
/**
 * Precondition for SOUND post-dominance (#2188 review): EXIT must be reachable
 * (forward) from every block that is itself reachable from ENTRY. When it
 * fails — an entry-reachable region that cannot reach EXIT, e.g. a
 * non-terminating loop or a multi-terminal CFG a future language visitor might
 * emit — the EXIT-rooted reverse walk degenerates (every such block gets
 * {@link NO_IPDOM}), which both DROPS real control dependences and INVENTS
 * spurious ones (the unsoundness documented in the module header). Consumers
 * ({@link emitFileCdg}) check this and skip CDG for the function rather than
 * persist an unsound projection — CFG and REACHING_DEF, which do not depend on
 * post-dominance, are unaffected.
 *
 * The current TS visitor always satisfies this (every loop is given a
 * structural `header → loopExit` edge, keeping EXIT reverse-reachable), so this
 * is a guard for future visitors and hand-built CFGs, not a behavior change
 * today. Pure and O(V+E).
 */
export declare function isExitReachableFromAllBlocks(cfg: FunctionCfg): boolean;
