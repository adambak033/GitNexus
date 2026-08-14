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
// ─── Builder ────────────────────────────────────────────────────────────────
export function buildMethodDispatchIndex(input) {
    const mroByOwnerDefId = new Map();
    const extendsOnlyByOwnerDefId = input.computeExtendsOnlyMro
        ? new Map()
        : undefined;
    const implsBuilding = new Map();
    const implsSeen = new Map();
    for (const ownerId of input.owners) {
        // First-write-wins on duplicate owner ids: a stable policy consistent
        // with sibling indexes (#913 DefIndex / ModuleScopeIndex).
        if (!mroByOwnerDefId.has(ownerId)) {
            const chain = input.computeMro(ownerId);
            mroByOwnerDefId.set(ownerId, Object.freeze(chain.slice()));
        }
        if (input.computeExtendsOnlyMro !== undefined &&
            extendsOnlyByOwnerDefId !== undefined &&
            !extendsOnlyByOwnerDefId.has(ownerId)) {
            const extOnly = input.computeExtendsOnlyMro(ownerId);
            extendsOnlyByOwnerDefId.set(ownerId, Object.freeze(extOnly.slice()));
        }
        for (const ifaceId of input.implementsOf(ownerId)) {
            let seen = implsSeen.get(ifaceId);
            if (seen === undefined) {
                seen = new Set();
                implsSeen.set(ifaceId, seen);
            }
            if (seen.has(ownerId))
                continue;
            seen.add(ownerId);
            let bucket = implsBuilding.get(ifaceId);
            if (bucket === undefined) {
                bucket = [];
                implsBuilding.set(ifaceId, bucket);
            }
            bucket.push(ownerId);
        }
    }
    const implsByInterfaceDefId = new Map();
    for (const [ifaceId, owners] of implsBuilding) {
        implsByInterfaceDefId.set(ifaceId, Object.freeze(owners.slice()));
    }
    return wrapIndex(mroByOwnerDefId, implsByInterfaceDefId, extendsOnlyByOwnerDefId);
}
// ─── Internal ───────────────────────────────────────────────────────────────
const EMPTY = Object.freeze([]);
function wrapIndex(mroByOwnerDefId, implsByInterfaceDefId, extendsOnlyMroByOwnerDefId) {
    const base = {
        mroByOwnerDefId,
        implsByInterfaceDefId,
        mroFor(ownerDefId) {
            return mroByOwnerDefId.get(ownerDefId) ?? EMPTY;
        },
        implementorsOf(interfaceDefId) {
            return implsByInterfaceDefId.get(interfaceDefId) ?? EMPTY;
        },
    };
    if (extendsOnlyMroByOwnerDefId !== undefined) {
        return {
            ...base,
            extendsOnlyMroByOwnerDefId,
            extendsOnlyMroFor(ownerDefId) {
                return extendsOnlyMroByOwnerDefId.get(ownerDefId) ?? EMPTY;
            },
        };
    }
    return base;
}
//# sourceMappingURL=method-dispatch-index.js.map