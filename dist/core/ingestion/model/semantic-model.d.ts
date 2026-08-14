/**
 * Semantic Model
 *
 * Top-level orchestrator for all resolution-time data. Owns:
 *
 *   - Three owner-scoped registries (types, methods, fields)
 *   - A nested SymbolTable (file + callable name indexes) wrapped so
 *     that `add()` fans out into the registries via the dispatch table
 *
 * ## Dependency direction
 *
 *     gitnexus-shared (NodeLabel)             — leaf
 *          ↑
 *     symbol-table.ts                         — pure file/callable index
 *          ↑
 *     model/type-registry / method-registry / field-registry
 *          ↑
 *     model/registration-table.ts             — dispatch table factory
 *          ↑
 *     model/semantic-model.ts                 — THIS FILE (orchestrator)
 *          ↑
 *     resolve.ts, call-processor.ts, ...
 *
 * `symbol-table.ts` is a leaf — it never imports from `./model/`. This
 * file (semantic-model.ts) is the ONLY place where SymbolTable and the
 * owner-scoped registries are composed. Upstream consumers pass around
 * the `SemanticModel` interface and reach into `.symbols` for file-scoped
 * operations or `.types` / `.methods` / `.fields` for owner-scoped ones.
 *
 * ## Fan-out via wrapped add()
 *
 * `createSemanticModel()` creates a pure SymbolTable, creates the three
 * registries, builds a dispatch table via `createRegistrationTable`, and
 * exposes a SymbolTable-shaped façade whose `add()`:
 *
 *   1. Calls `rawSymbols.add()` — writes the fileIndex + callable index
 *      and returns the fully-built `SymbolDefinition`.
 *   2. Runs pre-dispatch normalization (`Function`-with-`ownerId` routes
 *      as `Method`).
 *   3. Looks up the dispatch table and invokes the hook, which writes to
 *      the appropriate owner-scoped registry.
 *
 * The wrapper is the only place where the two layers are combined. A
 * direct `createSymbolTable()` caller (e.g. an isolated unit test) gets
 * the pure, registry-free behavior — no surprises, no hidden side
 * effects.
 *
 * ## Single-source-of-truth invariant
 *
 * `SemanticModel` is the authoritative symbol store for the whole
 * ingestion pipeline. Both the legacy Call-Resolution DAG and the
 * new scope-resolution pipeline read symbol-keyed lookups from here
 * exclusively — no parallel owner-keyed, name-keyed, or file-keyed
 * symbol indexes exist outside this module. The scope-resolution
 * pipeline does carry a small `WorkspaceResolutionIndex` for
 * `Scope`-valued maps (`classScopeByDefId`, `moduleScopeByFile`) that
 * `SemanticModel` structurally cannot hold, but nothing else.
 *
 * ## Write / read phase contract
 *
 * Writes to the model happen in three clearly-ordered phases during a
 * single ingestion run:
 *
 *   1. **Legacy parse phase** (`parsing-processor`) calls
 *      `symbols.add(...)` per extracted symbol, which fans out via
 *      the dispatch table into `types` / `methods` / `fields`.
 *   2. **Scope-resolution reconciliation** (`reconcileOwnership` in
 *      `scope-resolution/pipeline/reconcile-ownership.ts`) registers
 *      any `parsed.localDefs[i]` with a scope-resolution-corrected
 *      `ownerId` that the legacy pass missed (Python class-body
 *      methods are the canonical case). Idempotent.
 *   3. **Finalize-orchestrator** calls `attachScopeIndexes(...)` to
 *      stamp the materialized `ScopeResolutionIndexes` bundle onto
 *      `model.scopes`. One-shot; throws on a second call.
 *
 * After these three phases, the model is effectively frozen:
 *   - `attachScopeIndexes` applied `Object.freeze` to its bundle.
 *   - Downstream passes receive the narrowed `SemanticModel` reader
 *     handle (not `MutableSemanticModel`), so `.register()` /
 *     `.clear()` / `attachScopeIndexes()` are structurally absent.
 *
 * See `scope-resolution/contract/scope-resolver.ts` Contract
 * Invariant I9 for the scope-resolution-side rule and
 * `ARCHITECTURE.md` § "Semantic-model source of truth" for the
 * overall architecture.
 */
import type { TypeRegistry, MutableTypeRegistry } from './type-registry.js';
import type { MethodRegistry, MutableMethodRegistry } from './method-registry.js';
import type { FieldRegistry, MutableFieldRegistry } from './field-registry.js';
import type { SymbolTableReader, SymbolTableWriter } from './symbol-table.js';
import type { ScopeResolutionIndexes } from './scope-resolution-indexes.js';
/**
 * Aggregated read-only view of the semantic registries plus the nested
 * file/callable SymbolTable.
 *
 * `symbols` is typed as {@link SymbolTableReader} — consumers can query
 * symbols but cannot register new ones or trigger a reset. Callers that
 * need to register symbols or reset state must hold a
 * {@link MutableSemanticModel} reference instead, which widens
 * `symbols` back to {@link SymbolTableWriter} and adds `clear()` on the
 * model itself.
 *
 * This segregation is the runtime half of the principle of least
 * authority: a resolver that receives `SemanticModel` physically cannot
 * mutate the index, so it cannot desync the leaf from the owner-scoped
 * registries even accidentally.
 */
export interface SemanticModel {
    readonly types: TypeRegistry;
    readonly methods: MethodRegistry;
    readonly fields: FieldRegistry;
    readonly symbols: SymbolTableReader;
    /**
     * Materialized scope-resolution indexes from RFC #909 Ring 2 PKG #921.
     *
     * `undefined` until the finalize-orchestrator attaches them. Once set,
     * the scope-resolution resolvers consult these indexes.
     *
     * The attach is a one-shot write (see `MutableSemanticModel`). Callers
     * holding a read-only `SemanticModel` handle see either `undefined` or
     * the final frozen bundle — never a half-populated view.
     */
    readonly scopes?: ScopeResolutionIndexes;
}
/** Mutable variant — exposes the MutableX registries, a Writer-typed
 *  `symbols` facade, and a full-cascade reset. This is the interface
 *  held by the lifecycle owner (the parse pipeline); resolvers
 *  that only query should hold the narrower {@link SemanticModel}. */
export interface MutableSemanticModel extends SemanticModel {
    readonly types: MutableTypeRegistry;
    readonly methods: MutableMethodRegistry;
    readonly fields: MutableFieldRegistry;
    readonly symbols: SymbolTableWriter;
    /** Clear all registries AND the nested SymbolTable. */
    clear(): void;
    /**
     * Stamp the finalize-orchestrator's output onto this model.
     *
     * **One-shot write.** Throws when called a second time — the indexes are
     * meant to be materialized once per ingestion run. `Object.freeze` is
     * applied to the attached bundle so consumers cannot mutate after attach.
     *
     * `clear()` resets the attached bundle back to `undefined`, enabling a
     * fresh re-ingestion to attach a new bundle.
     */
    attachScopeIndexes(indexes: ScopeResolutionIndexes): void;
}
export declare const createSemanticModel: () => MutableSemanticModel;
