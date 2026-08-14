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
import type { SymbolDefinition } from './symbol-definition.js';
import type { DefId } from './types.js';
export interface DefIndex {
    readonly byId: ReadonlyMap<DefId, SymbolDefinition>;
    readonly size: number;
    get(id: DefId): SymbolDefinition | undefined;
    has(id: DefId): boolean;
}
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
export declare function buildDefIndex(defs: readonly SymbolDefinition[]): DefIndex;
//# sourceMappingURL=def-index.d.ts.map