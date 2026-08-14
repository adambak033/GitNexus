/**
 * Registration Dispatch Table
 *
 * Behavior-grouped O(1) dispatch table for routing `SymbolTable.add()`
 * registrations into the semantic registries. Replaces the cascading
 * `if/else` ladder in `symbol-table.ts` with a `Map<NodeLabel, RoutingDecision>`
 * whose entries point to closure-captured hooks.
 *
 * ## Ownership diagram
 *
 *     SemanticModel
 *       ├── types   (TypeRegistry)    ← classLikeHook / implHook write here
 *       ├── methods (MethodRegistry)  ← methodHook writes here
 *       ├── fields  (FieldRegistry)   ← propertyHook writes here
 *       └── symbols (SymbolTable)     ← owns fileIndex + callableByName,
 *                                       calls dispatch() in add()
 *
 * ## Behavior groups (5 hooks, 13 table entries)
 *
 * | Group         | NodeLabel values                                  | Hook         | Skip callable? |
 * |---------------|---------------------------------------------------|--------------|----------------|
 * | class-like    | Class, Struct, Interface, Enum, Record, Trait     | classLikeHook    | no             |
 * | method-like   | Method, Constructor                               | methodHook   | no             |
 * | property      | Property                                          | propertyHook | YES            |
 * | impl-block    | Impl                                              | implHook     | no             |
 * | callable-only | Function, Macro, Delegate                         | (no entry)   | no             |
 *
 * Every other `NodeLabel` is "inert" — reached by `fileIndex` only. No
 * specialized registry, no callable index append.
 *
 * ## How to add a new NodeLabel
 *
 * 1. Add the variant to the `NodeLabel` union in `gitnexus-shared/src/graph/types.ts`.
 * 2. Decide which behavior group it belongs to by asking "which lookups must
 *    return this symbol?" (not "what language feature is it?"). A new Swift
 *    `Extension` is class-like if you want owner-scoped method lookup on it;
 *    a new Kotlin `Object` is class-like for the same reason.
 * 3. Either:
 *    - Add a table entry here pointing at one of the existing hooks, OR
 *    - Add it to `CALLABLE_ONLY_LABELS` if it is a free callable, OR
 *    - Add it to `INERT_LABELS` if it's metadata-only (File, Folder, Decorator,
 *      etc.) — never queried via owner/class lookups.
 * 4. If none of the above fit — the new kind needs a brand-new registry —
 *    design the registry first in `model/`, then add a new hook closure
 *    and table entries. Update `DISPATCH_LABELS` / the exhaustiveness guard
 *    accordingly.
 *
 * The runtime exhaustiveness guard in `symbol-table.ts` will warn if a
 * `NodeLabel` is missing from all three sets.
 */
import type { NodeLabel, SymbolDefinition } from '../../../_shared/index.js';
import type { MutableTypeRegistry } from './type-registry.js';
import type { MutableMethodRegistry } from './method-registry.js';
import type { MutableFieldRegistry } from './field-registry.js';
/**
 * Registration hook — a pure side-effectful function closed over a
 * specific registry. Performs the specialized registry write into the
 * appropriate owner-scoped registry for one NodeLabel.
 *
 * Closure capture is the isolation mechanism: `propertyHook` literally
 * cannot call `types.registerClass` because its closure does not hold
 * a reference to `types`. This is the runtime half of the principle of
 * least authority — the compile-time half is enforced by TypeScript.
 *
 * The callable-index gate lives inside `SymbolTable.add()` via the
 * `FREE_CALLABLE_TYPES` allowlist — the dispatch table does not
 * participate in that decision.
 */
export type RegistrationHook = (name: string, def: SymbolDefinition) => void;
/**
 * Dependencies required to build the dispatch table. Matches the shape
 * that `createSemanticModel()` passes into `createRegistrationTable()`.
 */
export interface RegistrationTableDeps {
    readonly types: MutableTypeRegistry;
    readonly methods: MutableMethodRegistry;
    readonly fields: MutableFieldRegistry;
}
/**
 * Behavior category for a NodeLabel during ingestion. Determines which
 * registry (if any) receives the symbol write during `SymbolTable.add()`:
 *
 *   - `dispatch`     — owner-scoped registry write via the dispatch table
 *                      (Class/Struct/Interface/Enum/Record/Trait → types.registerClass,
 *                       Method/Constructor → methods.register,
 *                       Property → fields.register,
 *                       Impl → types.registerImpl)
 *   - `callable-only` — no specialized registry; symbol appears in
 *                      `callableByName` via `SymbolTable.add()`'s
 *                      FREE_CALLABLE_TYPES gate (Function/Macro/Delegate)
 *   - `inert`        — no registry, no callable index; file-index only
 *                      (metadata / structural nodes like Project, Module,
 *                      Import, Decorator, etc.)
 *
 * `Function` has a twist: `Function`-with-`ownerId` (Python `def` in a
 * class body, Rust trait method, Kotlin companion method) is pre-normalized
 * to `Method` in `createSemanticModel`'s `wrappedAdd` before dispatch lookup,
 * so only free functions actually flow through the callable-only path.
 */
export type LabelBehavior = 'dispatch' | 'callable-only' | 'inert';
/**
 * All known NodeLabels, derived from the keys of `LABEL_BEHAVIOR`. The
 * `satisfies Record<NodeLabel, LabelBehavior>` bijection above proves
 * that `Object.keys(LABEL_BEHAVIOR)` is exactly the NodeLabel set —
 * the cast to `NodeLabel[]` is sound, not a type-system bypass.
 *
 * Consumers (e.g., the semantic-model barrel re-export for tests) can
 * rely on this list being complete by construction. No runtime drift
 * check is needed or possible — the type system is the proof.
 */
export declare const ALL_NODE_LABELS: readonly NodeLabel[];
/**
 * NodeLabel values that are free callables — appear in `callableByName`
 * but have no owner-scoped specialized registry. Alias of
 * {@link FREE_CALLABLE_TYPES} exported here for taxonomy-test use. The
 * compile-time cross-invariant on `LABEL_BEHAVIOR` above guarantees the
 * alias and the LABEL_BEHAVIOR `callable-only` classification cannot
 * drift.
 */
export declare const CALLABLE_ONLY_LABELS: ReadonlySet<NodeLabel>;
/**
 * NodeLabel values that touch only the file index — no specialized
 * registry, no callable index.
 */
export declare const INERT_LABELS: ReadonlySet<NodeLabel>;
/**
 * NodeLabel values that have a dispatch table entry. `createRegistrationTable`
 * below must provide a hook for exactly this set — the test file's behavior-
 * group tests and the integration tests pin the hook↔label correspondence.
 */
export declare const DISPATCH_LABELS: ReadonlySet<NodeLabel>;
/**
 * Build the dispatch table. Must be called once per `createSymbolTable`
 * invocation so each hook closes over that SymbolTable's injected
 * registries. Reusing a single module-level instance would cause hooks
 * to write into the wrong SemanticModel.
 */
export declare const createRegistrationTable: (deps: RegistrationTableDeps) => Map<NodeLabel, RegistrationHook>;
