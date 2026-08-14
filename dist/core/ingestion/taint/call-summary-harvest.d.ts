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
import type { FunctionCfg } from '../cfg/types.js';
import { type FunctionDefUse } from '../cfg/reaching-defs.js';
/** The own-facts portion of a call summary (fnId/anchor added by the caller). */
export interface HarvestedCallSummaryFacts {
    readonly paramCount: number;
    /** Sorted, de-duplicated formal-parameter indices that flow to the return. */
    readonly returnFlowParams: readonly number[];
}
export interface CallSummaryHarvestResult {
    /** `computed` — facts derived; `coverage-gap` — the RD solver was not
     *  `computed`, so no summary is produced (consistent with the taint harvest). */
    readonly status: 'computed' | 'coverage-gap';
    readonly gapReason?: FunctionDefUse['status'];
    readonly facts: HarvestedCallSummaryFacts;
}
/**
 * Harvest the RETURN-VALUE ASCENT facts for one function. PRECONDITION: `cfg`
 * is `isEmitSafeCfg`-filtered and `defUse` was computed from it (the caller
 * gates exactly as the taint harvest path does).
 */
export declare function harvestCallSummary(cfg: FunctionCfg, defUse: FunctionDefUse): CallSummaryHarvestResult;
