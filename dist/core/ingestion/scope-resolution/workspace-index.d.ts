/**
 * `WorkspaceResolutionIndex` — scope-tied lookup tables built ONCE
 * per resolution run, after `populateOwners` and before any
 * resolution pass.
 *
 * ## Scope (what lives here vs. what lives in `SemanticModel`)
 *
 * This index carries only the lookups that return a `Scope` — things
 * `SemanticModel` structurally cannot provide:
 *
 *   - `classScopeByDefId` — class def `nodeId` → `Scope`. Needed so
 *     passes can read `scope.bindings`, `scope.typeBindings`, and
 *     `scope.ownedDefs`. SemanticModel's `TypeRegistry` carries class
 *     metadata but not the `Scope`.
 *   - `classScopeIdToDefId` — inverse of `classScopeByDefId`. O(1)
 *     reverse lookup (Scope.id → class def nodeId) for the implicit-
 *     `this` overload picker.
 *   - `moduleScopeByFile` — file path → `Scope` of the root `Module`.
 *     Used by cross-file return-type propagation, `findExportedDef`,
 *     and `findExportedDefByName`'s workspace-wide fallback.
 *     SymbolTable indexes symbols, not scopes.
 *
 * Symbol lookups live on `SemanticModel`:
 *   - Owner-keyed method lookup → `model.methods.lookupAllByOwner`
 *     (populated by the legacy parse phase via `symbolTable.add` AND
 *     by scope-resolution's reconciliation pass in `runScopeResolution`,
 *     which adds `parsed.localDefs[i].ownerId` entries missed by the
 *     legacy extractor for registry-primary languages).
 *   - Name-keyed callable lookup → `model.methods.lookupMethodByName`
 *     and `model.symbols.lookupCallableByName`.
 *   - File-indexed symbol lookup → `model.symbols.lookupExactAll`.
 *
 * This split preserves the single-source-of-truth invariant
 * documented in `ScopeResolver`'s contract file: symbol-indexed
 * lookups live on `SemanticModel` for the whole codebase; only
 * scope-shaped lookups (which `SemanticModel` doesn't carry) live
 * here.
 *
 * Build cost is O(totalScopes). Read-only after construction.
 */
import type { ParsedFile, ScopeTree } from '../../../_shared/index.js';
import type { WorkspaceResolutionIndex } from './workspace-index-types.js';
/** The index *shape* lives in the leaf `./workspace-index-types.js` so
 *  `scope/walkers.ts` — which this builder calls into — can type against it
 *  without importing this module back. Re-exported here so consumers keep
 *  importing the type and the builder from one place. */
export type { WorkspaceResolutionIndex } from './workspace-index-types.js';
/**
 * Build the workspace scope-lookup index. When `scopeTree` is supplied (the live
 * pipeline), the `Scope`-valued maps are id-backed views that delegate to it —
 * so this index never pins `Scope` objects and the disk seal can actually
 * reclaim them. Without it (unit tests), the legacy direct `Map<K, Scope>` form
 * is returned unchanged.
 */
export declare function buildWorkspaceResolutionIndex(parsedFiles: readonly ParsedFile[], scopeTree?: ScopeTree): WorkspaceResolutionIndex;
