/**
 * `MethodDispatchIndex` — materialized view of class hierarchies keyed by
 * `DefId` (RFC §3.1; Ring 2 SHARED #914).
 *
 * Two O(1)-access maps used by `Registry.lookupMethod` and interface-
 * dispatch callers:
 *
 *   - `mroByOwnerDefId`       : owner class → full MRO ancestor chain
 *                               (excludes the owner itself, in per-language
 *                               strategy order).
 *   - `implsByInterfaceDefId` : interface/trait → classes that implement it.
 *
 * **Not an MRO implementation.** The build function is a pure aggregator: it
 * asks the caller (via `computeMro` and `implementsOf` callbacks) for the
 * per-language answers and materializes the two-way index. MRO strategies
 * live where they already do today (`model/resolve.ts § c3Linearize`,
 * `languages/ruby.ts § selectDispatch`, etc.) — this index does not
 * reimplement them.
 *
 * Why callbacks and not a shared strategy registry: the five strategies
 * (Python C3, Ruby kind-aware, Java/Kotlin linear, Rust qualified-syntax,
 * COBOL none) already exist in the CLI package and depend on the CLI's
 * `HeritageMap` + `SemanticModel`. Pulling them into `gitnexus-shared` would
 * require migrating both — out of scope for #914. Callbacks let the shared
 * build stay pure while honoring existing strategies verbatim.
 *
 * Consumed by: #917 (`Registry.lookupMethod` MRO fast path, interface
 * dispatch resolver).
 */
import type { DefId } from './types.js';
export interface MethodDispatchIndex {
    /**
     * Full MRO ancestor chain per owner class (excludes the owner itself).
     * Order reflects the per-language strategy used by `computeMro`.
     */
    readonly mroByOwnerDefId: ReadonlyMap<DefId, readonly DefId[]>;
    /** Interfaces / traits → classes that implement them. */
    readonly implsByInterfaceDefId: ReadonlyMap<DefId, readonly DefId[]>;
    /**
     * Optional parallel MRO view that EXCLUDES mixin-like augmentation
     * (e.g., PHP traits). Populated only when the input supplies
     * `computeExtendsOnlyMro`. Used by the super-branch dispatch in
     * `receiver-bound-calls` so that `parent::method()` walks the
     * inheritance chain only, not the trait-augmented one. Undefined for
     * languages without mixin-like semantics — callers should fall back
     * to `mroFor` when this is missing.
     */
    readonly extendsOnlyMroByOwnerDefId?: ReadonlyMap<DefId, readonly DefId[]>;
    /** `mroByOwnerDefId.get`, with an empty frozen array on miss. */
    mroFor(ownerDefId: DefId): readonly DefId[];
    /** `implsByInterfaceDefId.get`, with an empty frozen array on miss. */
    implementorsOf(interfaceDefId: DefId): readonly DefId[];
    /**
     * `extendsOnlyMroByOwnerDefId.get`, with an empty frozen array on miss.
     * Undefined when `extendsOnlyMroByOwnerDefId` was not populated; callers
     * should treat this as equivalent to `mroFor` for non-mixin languages.
     */
    readonly extendsOnlyMroFor?: (ownerDefId: DefId) => readonly DefId[];
}
export interface MethodDispatchInput {
    /**
     * Owner defs to index (classes, structs, traits, interfaces — any kind
     * that can appear on the owner side of a method-dispatch graph).
     */
    readonly owners: readonly DefId[];
    /**
     * Return the full MRO ancestor chain for `ownerDefId`, **excluding the
     * owner itself**, in the order dictated by the owner's language-specific
     * MRO strategy.
     *
     * Contract:
     *   - Pure (no side effects).
     *   - Deterministic per input.
     *   - `undefined` not allowed — return `[]` when the owner has no parents.
     */
    readonly computeMro: (ownerDefId: DefId) => readonly DefId[];
    /**
     * Return the set of interface/trait defs that `ownerDefId` implements.
     * Transitive inclusion (e.g., `implements` on a parent class) is the
     * caller's choice — the build function simply inverts whatever is
     * returned.
     *
     * Repeated IDs in the output are deduplicated automatically.
     *
     * **Call-count contract.** `implementsOf` is invoked **once per
     * occurrence** of an owner in `input.owners`, not once per unique
     * owner. Duplicate owners therefore re-invoke it; dedup happens at
     * the bucket layer (after the callback returns). Callers with
     * expensive `implementsOf` implementations should pass a deduplicated
     * `owners` list. `computeMro`, by contrast, is memoized by the first-
     * write-wins policy and fires at most once per unique owner.
     */
    readonly implementsOf: (ownerDefId: DefId) => readonly DefId[];
    /**
     * Optional: return the EXTENDS-only ancestor chain for `ownerDefId`,
     * excluding the owner itself AND any mixin-like augmentation (e.g.,
     * PHP traits). Languages without mixin semantics leave this undefined
     * and the index's `extendsOnlyMroByOwnerDefId` stays unpopulated.
     *
     * Same contract as `computeMro`: pure, deterministic, `[]` on no parents.
     * Called at most once per unique owner (first-write-wins).
     */
    readonly computeExtendsOnlyMro?: (ownerDefId: DefId) => readonly DefId[];
}
export declare function buildMethodDispatchIndex(input: MethodDispatchInput): MethodDispatchIndex;
//# sourceMappingURL=method-dispatch-index.d.ts.map