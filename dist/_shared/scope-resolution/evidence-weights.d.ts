/**
 * `EvidenceWeights` — RFC Appendix A (authoritative values).
 *
 * Starting calibration for scope-based resolution. Shadow-first rollout
 * tunes these against legacy DAG parity. Every `ResolutionEvidence.weight`
 * value in the codebase MUST reference this map; inline magic numbers are a
 * lint violation. Extends issue #429 (centralize hardcoded confidence values).
 *
 * Evidence composes additively inside `composeEvidence`; the sum is capped
 * at 1.0 in `Resolution.confidence`.
 */
/**
 * Authoritative weight map. Keys are a mix of `ResolutionEvidence.kind`
 * values and special modifiers (scope-chain depth, MRO depth decay,
 * unlinked-import multiplicative cap).
 */
export declare const EvidenceWeights: {
    /** `BindingRef.origin === 'local'` */
    readonly local: 0.55;
    /** `BindingRef.origin === 'import'` */
    readonly import: 0.45;
    /** `BindingRef.origin === 'reexport'` */
    readonly reexport: 0.4;
    /** `BindingRef.origin === 'namespace'` */
    readonly namespace: 0.4;
    /** `BindingRef.origin === 'wildcard'` */
    readonly wildcard: 0.3;
    /** Deducted per parent-hop taken (depth-0 = 0, depth-1 = −0.02, …). */
    readonly scopeChainPerDepth: -0.02;
    /**
     * Weight applied when the receiver's type binding resolves to a class that
     * declares the candidate as a method/field. Decays by MRO depth: direct
     * class = index 0; 1 parent hop = index 1; etc. Falls back to the last
     * value for depths beyond the table.
     */
    readonly typeBindingByMroDepth: readonly [0.5, 0.42, 0.36, 0.32, 0.3];
    /** `def.ownerId === resolvedReceiver.def.id` (exact owner match). */
    readonly ownerMatch: 0.2;
    /** Explanatory only — retained for debuggability. Never discriminates
     *  because surviving candidates already passed `acceptedKinds`. */
    readonly kindMatch: 0;
    /** `provider.arityCompatibility(...) === 'compatible'` */
    readonly arityMatchCompatible: 0.1;
    /** `provider.arityCompatibility(...) === 'unknown'` */
    readonly arityMatchUnknown: 0;
    /** `provider.arityCompatibility(...) === 'incompatible'` — penalizes;
     *  candidates filtered only when a compatible candidate exists. */
    readonly arityMatchIncompatible: -0.15;
    /** Hit via `QualifiedNameIndex.byQualifiedName`. */
    readonly globalQualified: 0.35;
    /** Fallback hit in a `byName` index (and nothing was lexically visible). */
    readonly globalName: 0.1;
    /** Call/reference flowing through a `dynamic-unresolved` edge. */
    readonly dynamicImportUnresolved: 0.02;
    /**
     * Multiplicative cap on the edge-derived evidence signal
     * (`import`/`wildcard`/`reexport`/`namespace`) when
     * `ImportEdge.linkStatus === 'unresolved'`. Independent corroborating
     * signals on the same candidate (`owner-match`, `arity-match`,
     * `type-binding`) are NOT penalized.
     */
    readonly unlinkedImportMultiplier: 0.5;
};
/**
 * Look up the `type-binding` signal weight for a given MRO depth, falling
 * back to the last tabulated value for depths beyond the table.
 */
export declare function typeBindingWeightAtDepth(mroDepth: number): number;
//# sourceMappingURL=evidence-weights.d.ts.map