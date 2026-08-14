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
import { computePostDominators, NO_IPDOM } from './post-dominators.js';
function buildArmSenses(cfg) {
    const n = cfg.blocks.length;
    const senses = Array.from({ length: n }, () => ({
        hasTrueArm: false,
        hasFalseArm: false,
    }));
    for (const e of cfg.edges) {
        if (e.from < 0 || e.from >= n)
            continue;
        if (e.kind === 'cond-true' || e.kind === 'switch-case')
            senses[e.from].hasTrueArm = true;
        else if (e.kind === 'cond-false')
            senses[e.from].hasFalseArm = true;
    }
    return senses;
}
/**
 * The CDG label ('T'|'F') for a control-dependence edge, given the controlling
 * block's arm senses. An explicitly-sensed edge is taken at face value; an
 * ambiguous fall-through edge (`seq`/`loop-back`/`fallthrough`/jump) is the
 * COMPLEMENT of the controller's explicit sibling arm. Per-case `switch` value
 * labels are deferred to #2086 — every `switch-case` is 'T' in M5.
 */
function labelFor(kind, controller) {
    if (kind === 'cond-true' || kind === 'switch-case')
        return 'T';
    if (kind === 'cond-false')
        return 'F';
    // Ambiguous structural kind: take the complement of the controller's explicit
    // arm. A block with a true arm reaches here via its false fall-through; a
    // do/while bottom-test (false arm = cond-false) reaches here via its true
    // loop-back. With neither explicit arm (a degenerate / exit-unreachable
    // region — see #2188 F2, where the dependence itself is unsound) the sense is
    // indeterminate; default 'F' since fall-through is the common case.
    if (controller.hasTrueArm)
        return 'F';
    if (controller.hasFalseArm)
        return 'T';
    return 'F';
}
/**
 * Compute control-dependence edges for one function's CFG. `postDom` may be
 * supplied to reuse an already-built tree; otherwise it is computed. See the
 * module doc for the purity/determinism contract.
 */
export function computeControlDependence(cfg, postDom, 
// Output-size ceiling, mirroring computeReachingDefs' `maxFacts` (#2188 review).
// The reverse-DF set is the bounded (controller, dependent, label) dependence
// relation, so peak working set ≈ output here (no pre-dedup spike like the old
// up-walk) — this caps the final edge COUNT, not transient memory. `0` ⇒
// unbounded. On overflow `edges` is a deterministic SORTED prefix and
// `truncated` is set — never a silent drop. (The sorted prefix is the prefix
// CONTENTS may differ from the old up-walk's CFG-edge-iteration prefix at the
// cap boundary; the FULL untruncated set is byte-identical — see the module doc.)
maxEdges = 0) {
    const tree = postDom ?? computePostDominators(cfg);
    const { ipdom } = tree;
    const n = cfg.blocks.length;
    const armSenses = buildArmSenses(cfg);
    const cap = maxEdges > 0 ? maxEdges : Infinity;
    // Reverse-CFG post-dominance frontier (Cytron, Ferrante, Rosen, Wegman,
    // Zadeck 1991): control dependence IS the dominance frontier of the reverse
    // CFG. `A ∈ PDF(X)` ⟺ X is control-dependent on A, so emit (controller=A,
    // dependent=X). Computing the PDF bottom-up over the post-dom tree charges
    // each up-step to a DISTINCT emitted entry — O(N+E+output) — instead of the
    // old Ferrante up-walk that re-climbs the ipdom chain per CFG edge (Θ(N²) on
    // a deep post-dom chain). Output is the identical (controller, dependent,
    // label) set (verified byte-identical on 3203 CFGs across all languages +
    // fuzz) and 1-2 orders of magnitude faster. LLVM (ReverseIDFCalculator),
    // Joern (CdgPass) and WALA use the same formulation.
    const children = Array.from({ length: n }, () => []);
    const inEdges = Array.from({ length: n }, () => []);
    for (let b = 0; b < n; b++) {
        const ip = ipdom[b];
        if (ip !== NO_IPDOM && ip >= 0 && ip < n)
            children[ip].push(b);
    }
    for (const e of cfg.edges) {
        if (e.from < 0 || e.from >= n || e.to < 0 || e.to >= n)
            continue;
        inEdges[e.to].push({ from: e.from, kind: e.kind });
    }
    // Post-dom-tree post-order (children before parents). Iterative — the post-dom
    // forest can itself be chain-deep. Roots are the NO_IPDOM nodes (EXIT, plus
    // any exit-unreachable region per #2188 F2). The reverse of a root-first DFS
    // visits every parent AFTER all its descendants.
    const dfs = [];
    for (let r = 0; r < n; r++)
        if (ipdom[r] === NO_IPDOM)
            dfs.push(r);
    const preorder = [];
    while (dfs.length) {
        const x = dfs.pop();
        preorder.push(x);
        for (const c of children[x])
            dfs.push(c);
    }
    const order = preorder.reverse();
    // PDF[X]: controller A → the label SET with which A controls X. A set (not one
    // label) because a controller can reach X via opposite-sense arms (goto-
    // cycles) — the old (a, cur, label) dedup kept both rows.
    const pdf = Array.from({ length: n }, () => new Map());
    const add = (x, a, label) => {
        const set = pdf[x].get(a);
        if (set)
            set.add(label);
        else
            pdf[x].set(a, new Set([label]));
    };
    for (const x of order) {
        // PDF_local: a CFG-predecessor A of X that X does not (immediately) post-
        // dominate. `A !== X && ipdom[A] !== X` is exactly the production
        // `!postDominates(X, A)` for one edge A→X (postDominates(X,A) ⟺ ipdom[A]===X),
        // and it excludes self-edges + NO_IPDOM regions. Sense is read from the
        // CONTROLLER's arms (seq/loop-back fall-through false arms would otherwise
        // mislabel as 'T' — #2188 F1).
        for (const { from: a, kind } of inEdges[x]) {
            if (a !== x && ipdom[a] !== x)
                add(x, a, labelFor(kind, armSenses[a]));
        }
        // PDF_up: inherit each post-dom child's frontier controller (with its label
        // set) when X does not post-dominate it.
        for (const z of children[x]) {
            for (const [a, labels] of pdf[z]) {
                if (ipdom[a] !== x)
                    for (const l of labels)
                        add(x, a, l);
            }
        }
    }
    const out = [];
    for (const x of order) {
        for (const [a, labels] of pdf[x]) {
            for (const label of labels)
                out.push({ controllerBlock: a, dependentBlock: x, label });
        }
    }
    out.sort((x, y) => x.controllerBlock - y.controllerBlock ||
        x.dependentBlock - y.dependentBlock ||
        (x.label < y.label ? -1 : x.label > y.label ? 1 : 0));
    // `maxEdges` is a heap-safety backstop applied to the SORTED set (the DF makes
    // overflow far rarer than the old per-edge walk). Deterministic prefix, never
    // a silent drop; mirrors computeReachingDefs' `truncated`.
    let truncated = false;
    if (cap !== Infinity && out.length > cap) {
        truncated = true;
        out.length = cap;
    }
    return { edges: out, truncated };
}
