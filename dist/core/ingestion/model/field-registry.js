/**
 * Field Registry
 *
 * Owner-scoped field/property index extracted from SymbolTable.
 * Stores Property / Variable / Const / Static symbols keyed by
 * `ownerNodeId\0fieldName` for O(1) lookup. Supports multiple defs
 * under the same (owner, name) — e.g. legacy Property plus a
 * scope-resolution Variable reconciliation entry.
 */
const EMPTY = Object.freeze([]);
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export const createFieldRegistry = () => {
    const fieldByOwner = new Map();
    const lookupAllByOwner = (ownerNodeId, fieldName) => {
        return fieldByOwner.get(`${ownerNodeId}\0${fieldName}`) ?? EMPTY;
    };
    const lookupFieldByOwner = (ownerNodeId, fieldName) => {
        const pool = lookupAllByOwner(ownerNodeId, fieldName);
        return pool.length === 0 ? undefined : pool[0];
    };
    const register = (ownerNodeId, fieldName, def) => {
        const key = `${ownerNodeId}\0${fieldName}`;
        const existing = fieldByOwner.get(key);
        if (existing) {
            existing.push(def);
        }
        else {
            fieldByOwner.set(key, [def]);
        }
    };
    const clear = () => {
        fieldByOwner.clear();
    };
    return { lookupFieldByOwner, lookupAllByOwner, register, clear };
};
