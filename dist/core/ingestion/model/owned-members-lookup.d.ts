/**
 * Owner-keyed member lookup for Step 2 (RFC #909 / PR #1656).
 *
 * Merges MethodRegistry + FieldRegistry hits for `(ownerDefId, memberName)`
 * in O(1) map time per registry — no `defs.byId` scan. Callers that omit
 * this helper and leave `ownedMembersByOwner` unset fall back to an O(|defs|)
 * compatibility scan inside `lookupCore.collectOwnedMembers`.
 */
import type { DefId, SymbolDefinition } from '../../../_shared/index.js';
import type { SemanticModel } from './semantic-model.js';
/**
 * Production hook for `RegistryContext.ownedMembersByOwner`.
 * Returns `[]` on miss (authoritative indexed empty) — never `undefined`.
 *
 * Merges hits from all three owner-keyed registries (methods, fields,
 * nested types) under the same `(ownerDefId, memberName)` key. The
 * caller's `acceptedKinds` filter in `lookupCore` picks the right subset.
 */
export declare function lookupOwnedMembersByOwner(model: Pick<SemanticModel, 'methods' | 'fields' | 'types'>, ownerDefId: DefId, memberName: string): readonly SymbolDefinition[];
