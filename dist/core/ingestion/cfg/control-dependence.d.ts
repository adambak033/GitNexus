/**
 * Control dependence (#2085 M5 U3) — Ferrante, Ottenstein & Warren §3.1.1
 * semantics. A block `dependent` is control-dependent on a branch block
 * `controller` when `controller` decides whether `dependent` executes: formally,
 * there is a CFG edge `controller → B` such that `dependent` post-dominates `B`
 * but does NOT strictly post-dominate `controller`.
 *
 * Construction — the reverse-CFG dominance-frontier formulation (Cytron,
 * Ferrante, Rosen, Wegman & Zadeck 1991): control dependence IS the dominance
 * frontier of the reverse CFG, so `A ∈ PDF(X)` (the post-dominance frontier)
 * ⟺ `X` is control-dependent on `A`. The PDF is computed bottom-up over the
 * post-dom tree (`PDF_local` from a node's CFG predecessors + `PDF_up` from its
 * post-dom-tree children) in O(N + E + output) — each up-step is charged to a
 * distinct emitted edge, NOT re-walked per CFG edge as the original §3.1.1
 * up-walk did (which was Θ(N²) on a deep post-dom chain). The two formulations
 * enumerate the IDENTICAL full `(controller, dependent, label)` set (verified
 * byte-identical on 3203 CFGs + ~1M-case differential fuzz); LLVM, Joern and WALA
 * use the reverse-DF form. (Only the rare TRUNCATED prefix — when a function
 * exceeds `maxEdges` — differs from the old prefix: it is now a sorted
 * deterministic prefix rather than CFG-edge-iteration order. Both are valid,
 * deterministic subsets; the full untruncated output is unchanged.)
 * The branch SENSE ('T' | 'F') of the controlling edge becomes the edge label
 * (KTD4 / KTD3 — it rides the persisted relation's `reason` column).
 *
 * PURE AND DETERMINISTIC (mirrors post-dominators.ts / reaching-defs.ts): no
 * graph, no logger, importable outside the worker; output is deduped per
 * (controller, dependent, label) and sorted, so snapshot tests and
 * content-derived edge ids are stable. The loop header legitimately appears as
 * control-dependent on ITSELF (`controller === dependent`) — the loop predicate
 * gates its own re-execution; this is standard PDG behavior, not a bug.
 */
import { type PostDomTree } from './post-dominators.js';
import type { FunctionCfg } from './types.js';
export type CdgLabel = 'T' | 'F';
export interface ControlDepEdge {
    /** The branch block whose outcome controls `dependentBlock`. */
    readonly controllerBlock: number;
    /** The block that executes only because `controllerBlock` took `label`. */
    readonly dependentBlock: number;
    /** Branch sense of the controlling CFG edge — see {@link branchSense}. */
    readonly label: CdgLabel;
}
export interface ControlDepResult {
    /** Deduped, sorted (controller, dependent, label) control-dependence edges. */
    readonly edges: readonly ControlDepEdge[];
    /**
     * True when the `maxEdges` ceiling was reached; `edges` is then a
     * deterministic prefix (CFG-edge iteration order, sorted), never a silent
     * drop. Mirrors {@link computeReachingDefs}'s `truncated`.
     */
    readonly truncated: boolean;
}
/**
 * Compute control-dependence edges for one function's CFG. `postDom` may be
 * supplied to reuse an already-built tree; otherwise it is computed. See the
 * module doc for the purity/determinism contract.
 */
export declare function computeControlDependence(cfg: FunctionCfg, postDom?: PostDomTree, maxEdges?: number): ControlDepResult;
