/**
 * Per-function dependence-SUMMARY harvest (PDG FU-C, U-C2).
 *
 * Pure, deterministic derivation of one function's RETURN-VALUE ASCENT — which
 * formal-parameter indices flow to the function's return value — from the SAME
 * substrate the M2/M3 passes consume: the reaching-definition facts
 * (`computeReachingDefs`) over the function's CFG. No graph, no I/O, no logger;
 * mirrors the {@link harvestFunctionSummary} (taint) contract so snapshot tests
 * and the version stamp stay stable. Runs IN-PHASE inside the scope-resolution
 * pdg window where the RD facts are materialised (reusing them — zero new
 * worker/CFG work, so NO parse-cache pdg:N bump).
 *
 * ## Return-site identification (language-agnostic, soundness-first)
 *
 * Return statements are identified STRUCTURALLY via the M2 edge-kind invariant:
 * the SOURCE block of every CFG edge of kind `return` terminates in the return
 * jump, so that block's LAST statement is the `return <expr>` — its `uses` are
 * the returned bindings. A `return;` with no value has empty uses (contributes
 * nothing). For languages whose visitor models IMPLICIT returns (arrow-function
 * expression bodies, Python last-expression), the CFG emits a `return` edge to
 * EXIT whose source block's last statement carries the returned expression's
 * `uses`, so those flow through the same path with no language-specific code.
 *
 * SOUNDNESS = never claim a false return-flow: when a function has NO `return`
 * CFG edge (a language/shape with no robust exit notion modelled, or a void
 * function), `returnUseStmtKeys` is empty and the harvest emits an EMPTY summary
 * — the absence of a fact, never a wrong one.
 *
 * ## Param → return reachability
 *
 * Each formal parameter is seeded as a value at its entry def point(s); forward
 * reachability over the def→use facts marks the param's index as return-flowing
 * the moment a tainted binding it produced (under the M3 statement-level floor:
 * a statement using a value taints all of its defs/mayDefs) is among a
 * return-use statement's `uses`. The recorded edge is from an ACTUAL binding
 * occurrence in a return's uses — never the floor — keeping the recorded fact
 * precise even though onward propagation over-approximates.
 *
 * ## Formal-position soundness — destructured / rest params
 *
 * The consumer reads `returnFlowParams` POSITIONALLY (call-site arg position →
 * same-index formal → bitset), so each recorded index MUST be the 0-based
 * ENCLOSING FORMAL position, never the flattened binding ordinal. A
 * destructured/rest formal binds several names: `function f({a, b}, c)` flattens
 * to bindings a, b, c, whose ORDINALS are 0, 1, 2 — but the formal positions are
 * 0, 0, 1. Recording an ordinal would misattribute `b`'s return-flow to formal
 * `c` (a FALSE return-flow claim, not a miss). To stay sound we key every
 * recorded index on {@link BindingEntry.formalIndex} (the producer-supplied
 * enclosing-formal position, identical for every inner name of one formal).
 *
 * CONSERVATIVE FALLBACK: a producer that does not yet supply `formalIndex` on
 * its param bindings leaves the harvest unable to prove the ordinal equals the
 * formal slot, so the harvest emits an EMPTY summary for that function — a
 * documented MISS (loses ascent), NEVER a false claim. Functions whose every
 * param binding carries `formalIndex` get the precise formal positions.
 */
import { pointKey } from '../cfg/reaching-defs.js';
const EMPTY_FACTS = { paramCount: 0, returnFlowParams: [] };
/**
 * Harvest the RETURN-VALUE ASCENT facts for one function. PRECONDITION: `cfg`
 * is `isEmitSafeCfg`-filtered and `defUse` was computed from it (the caller
 * gates exactly as the taint harvest path does).
 */
export function harvestCallSummary(cfg, defUse) {
    if (defUse.status !== 'computed') {
        return { status: 'coverage-gap', gapReason: defUse.status, facts: EMPTY_FACTS };
    }
    const bindings = defUse.bindings;
    // ── param bindings → ENCLOSING FORMAL position ────────────────────────────
    // SOUNDNESS (FU-C): the consumer joins `returnFlowParams` positionally against
    // call-site arg positions, so each index MUST be the 0-based enclosing formal
    // position — `BindingEntry.formalIndex`, which a destructured/rest formal hands
    // identically to every inner name. The flattened binding ORDINAL is NOT a safe
    // substitute (`function f({a, b}, c)` ⇒ b's ordinal 1 collides with formal c).
    const paramBindings = bindings
        .map((b, idx) => ({ b, idx }))
        .filter((e) => e.b.kind === 'param')
        .sort((a, b) => a.b.declLine - b.b.declLine || a.b.declColumn - b.b.declColumn);
    // CONSERVATIVE FALLBACK: build binding-index → enclosing-formal-position only
    // while every param binding supplies `formalIndex` (narrowed per-entry, no
    // assertion). If ANY lacks it, the ordinal-vs-formal mapping is unprovable, so
    // the summary degrades to EMPTY below (a documented MISS, never a false claim).
    const paramCount = paramBindings.length;
    const paramFormalOf = new Map();
    let missingFormalIndex = false;
    for (const e of paramBindings) {
        const formalIndex = e.b.formalIndex;
        if (formalIndex === undefined) {
            missingFormalIndex = true;
            break;
        }
        paramFormalOf.set(e.idx, formalIndex);
    }
    // ── return points: source block of every `return` CFG edge ────────────────
    // The M2 edge-kind invariant: a `return` edge's SOURCE block terminates in the
    // return jump, so its LAST statement is `return <expr>` — its `uses` are the
    // returned bindings. (`return;` with no value has empty uses.) No `return`
    // edge ⇒ empty set ⇒ EMPTY summary (sound — never a false return-flow claim).
    const returnUseStmtKeys = new Set();
    for (const e of cfg.edges) {
        if (e.kind !== 'return')
            continue;
        const block = cfg.blocks[e.from];
        const stmts = block?.statements;
        if (!stmts || stmts.length === 0)
            continue;
        returnUseStmtKeys.add(`${e.from}:${stmts.length - 1}`);
    }
    // Fast exit: no params, no return sites, or an unprovable formal mapping
    // (conservative fallback) ⇒ nothing safely flows to the return.
    if (paramCount === 0 || returnUseStmtKeys.size === 0 || missingFormalIndex) {
        return { status: 'computed', facts: { paramCount, returnFlowParams: [] } };
    }
    const stmtAt = (p) => cfg.blocks[p.blockIndex]?.statements?.[p.stmtIndex];
    // ── def→use index ─────────────────────────────────────────────────────────
    const factsByDef = new Map();
    for (const f of defUse.facts) {
        const key = `${f.bindingIdx}:${pointKey(f.def)}`;
        const list = factsByDef.get(key);
        const entry = { bindingIdx: f.bindingIdx, use: f.use };
        if (list)
            list.push(entry);
        else
            factsByDef.set(key, [entry]);
    }
    // ── seeds: each param at its entry def point(s) ────────────────────────────
    const queue = [];
    const visited = new Set();
    const enqueue = (v) => {
        const key = `${v.paramIdx}:${v.bindingIdx}:${pointKey(v.point)}`;
        if (visited.has(key))
            return;
        visited.add(key);
        queue.push(v);
    };
    for (const { idx } of paramBindings) {
        // 0-based ENCLOSING formal position — guaranteed present (the missing-formal
        // case returned EMPTY above), but guard rather than assert to stay `any`-free.
        const paramIdx = paramFormalOf.get(idx);
        if (paramIdx === undefined)
            continue;
        for (const f of defUse.facts) {
            if (f.bindingIdx === idx && f.def.blockIndex === cfg.entryIndex) {
                enqueue({ bindingIdx: idx, point: f.def, paramIdx });
            }
        }
    }
    // ── forward reachability ──────────────────────────────────────────────────
    const returnFlow = new Set();
    let head = 0;
    while (head < queue.length) {
        const v = queue[head++];
        const b = v.bindingIdx;
        for (const fact of factsByDef.get(`${b}:${pointKey(v.point)}`) ?? []) {
            const useStmt = stmtAt(fact.use);
            if (!useStmt)
                continue;
            const useKey = `${fact.use.blockIndex}:${fact.use.stmtIndex}`;
            // (1) return reach: the param's value is among a return-use's `uses`.
            if (returnUseStmtKeys.has(useKey) && useStmt.uses.includes(b)) {
                returnFlow.add(v.paramIdx);
            }
            // (2) onward floor: this statement's defs/mayDefs carry the value onward.
            for (const d of [...useStmt.defs, ...(useStmt.mayDefs ?? [])]) {
                enqueue({
                    bindingIdx: d,
                    point: {
                        blockIndex: fact.use.blockIndex,
                        stmtIndex: fact.use.stmtIndex,
                        line: useStmt.line,
                    },
                    paramIdx: v.paramIdx,
                });
            }
        }
    }
    const returnFlowParams = [...returnFlow].sort((a, b) => a - b);
    return { status: 'computed', facts: { paramCount, returnFlowParams } };
}
