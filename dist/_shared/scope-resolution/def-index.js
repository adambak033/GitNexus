/**
 * `DefIndex` — O(1) `DefId → SymbolDefinition` materialization.
 *
 * The global "what is this id?" lookup. Every per-kind registry (ClassRegistry,
 * MethodRegistry, FieldRegistry) returns `DefId[]` and resolves them back to
 * full `SymbolDefinition` records through this index — one central hash map,
 * one allocation per def.
 *
 * Part of RFC #909 Ring 2 SHARED — #913.
 *
 * Consumed by: #917 (`Registry.lookup` implementations), #915 (SCC finalize).
 */
/**
 * Build a `DefIndex` from a flat list of `SymbolDefinition` records.
 *
 * **Collision policy: first-write-wins.** `DefId` is meant to be unique
 * (`nodeId` is the stable graph identifier), so a collision indicates an
 * upstream bug — most likely the same symbol parsed twice or a duplicate
 * commit into the pipeline. Rather than silently overwriting with a later
 * definition that may be partial or wrong, the first record wins and
 * subsequent records for the same id are dropped. Pipeline bugs surface
 * later as `has(id) === true` but the def looking older than expected,
 * which is easier to debug than a silent overwrite.
 *
 * Pure function — safe to call repeatedly; no side effects.
 */
export function buildDefIndex(defs) {
    const byId = new Map();
    for (const def of defs) {
        if (byId.has(def.nodeId))
            continue; // first-write-wins
        byId.set(def.nodeId, def);
    }
    return wrapIndex(byId);
}
// ─── Internal ───────────────────────────────────────────────────────────────
function wrapIndex(byId) {
    return {
        byId,
        get size() {
            return byId.size;
        },
        get(id) {
            return byId.get(id);
        },
        has(id) {
            return byId.has(id);
        },
    };
}
//# sourceMappingURL=def-index.js.map