/**
 * `composeEvidence` — translate accumulated raw signals per candidate
 * into a `ResolutionEvidence[]` using the authoritative `EvidenceWeights`
 * map (RFC §4.3 + Appendix A; Ring 2 SHARED #917).
 *
 * Each `RawSignals` record describes what was observed about a candidate
 * during the 7-step walk: where it was found, at what depth, whether
 * anything corroborates it. This module turns those raw facts into the
 * typed evidence list attached to the outgoing `Resolution`.
 *
 * **Every weight comes from `EvidenceWeights`.** No inline magic numbers.
 * Extends issue #429 (centralize hardcoded confidence values).
 *
 * **Confidence compose rule.** Signals add; the sum is capped at 1.0 at
 * the call site (inside `lookupCore`). This module only emits the list;
 * it does NOT compute the capped sum so callers can inspect per-signal
 * contributions for debugging.
 */
import type { BindingRef, ResolutionEvidence } from '../types.js';
/**
 * Raw signals observed for a single candidate during the 7-step walk.
 * Optional fields encode "this signal did not fire"; presence encodes
 * "emit an evidence record".
 */
export interface RawSignals {
    /** Visibility origin of the binding that produced this candidate. */
    readonly origin?: BindingRef['origin'] | 'global-qualified' | 'global-name';
    /** Depth at which the binding was found (hops up from start scope). */
    readonly scopeChainDepth?: number;
    /** `ImportEdge` that brought the name in; present when origin is a non-local. */
    readonly viaUnlinkedImport?: boolean;
    /** Set when the candidate came via the receiver's type-binding MRO walk. */
    readonly typeBindingMroDepth?: number;
    /** `def.ownerId === resolvedReceiver.def.nodeId`. */
    readonly ownerMatch?: boolean;
    /** Always fires for candidates that pass `acceptedKinds`; weight 0. */
    readonly kindMatch: true;
    readonly arityVerdict?: 'compatible' | 'unknown' | 'incompatible';
    /** Candidate flows through a `kind: 'dynamic-unresolved'` ImportEdge. */
    readonly dynamicUnresolved?: boolean;
}
/**
 * Compose the raw signals into a stable `ResolutionEvidence[]` list.
 *
 * Emission order mirrors the `EvidenceWeights` layout: where-found →
 * type-binding → corroborators → arity → degraded. Stable order makes
 * the per-signal contributions easy to reason about in tests.
 */
export declare function composeEvidence(signals: RawSignals): readonly ResolutionEvidence[];
/**
 * Sum evidence weights and clamp to `[0, 1]`. Separate from `composeEvidence`
 * so tests can inspect the raw evidence list.
 */
export declare function confidenceFromEvidence(evidence: readonly ResolutionEvidence[]): number;
//# sourceMappingURL=evidence.d.ts.map