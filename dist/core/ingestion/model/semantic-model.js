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
import { createTypeRegistry } from './type-registry.js';
import { createMethodRegistry } from './method-registry.js';
import { createFieldRegistry } from './field-registry.js';
import { createSymbolTable } from './symbol-table.js';
import { createRegistrationTable } from './registration-table.js';
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
//
// NodeLabel taxonomy drift detection lives in `registration-table.ts` as a
// pure compile-time check — the `LABEL_BEHAVIOR` map is
// `Record<NodeLabel, LabelBehavior>` with `as const satisfies`, which proves
// coverage, uniqueness, and no-extra-keys at build time. No runtime guard
// is needed because drift is structurally impossible in the source.
export const createSemanticModel = () => {
    // 1. Create the pure, registry-unaware SymbolTable leaf.
    // rawSymbols is the only handle in the codebase whose type (the
    // internal createSymbolTable return) includes `.clear()`. cascadeClear
    // below reaches it here; no external caller receives this variable.
    const rawSymbols = createSymbolTable();
    // 2. Create the three owner-scoped registries.
    const types = createTypeRegistry();
    const methods = createMethodRegistry();
    const fields = createFieldRegistry();
    // 3. Build the dispatch table, closed over THIS instance's registries.
    const dispatchTable = createRegistrationTable({ types, methods, fields });
    // 4. Wrap rawSymbols so `add()` fans out into the registries via the
    //    dispatch table. See module JSDoc for the three-step contract.
    const wrappedAdd = (filePath, name, nodeId, type, metadata) => {
        const def = rawSymbols.add(filePath, name, nodeId, type, metadata);
        // Function-with-ownerId (Python `def` in a class body, Rust trait
        // method, Kotlin companion method) routes as Method. Keeps the
        // dispatch table single-purpose.
        const dispatchKey = type === 'Function' && metadata?.ownerId !== undefined ? 'Method' : type;
        const hook = dispatchTable.get(dispatchKey);
        if (hook) {
            hook(name, def);
        }
        return def;
    };
    // Scope-resolution bundle slot. Starts `undefined`; populated by a
    // one-shot `attachScopeIndexes(...)` from the finalize-orchestrator.
    // Held inside the factory closure so the returned `SemanticModel`
    // surface exposes it as a plain `readonly` property without a setter.
    let attachedScopes;
    const attachScopeIndexes = (indexes) => {
        if (attachedScopes !== undefined) {
            throw new Error('SemanticModel: scope indexes already attached. ' + 'Call `clear()` before re-attaching.');
        }
        attachedScopes = Object.freeze(indexes);
    };
    // Cascade clear: single source of truth for "reset the entire model".
    // Wired into both `model.clear()` AND `model.symbols.clear()` so that a
    // caller holding only a SymbolTable reference can't leave the
    // owner-scoped registries populated while the file/callable indexes go
    // empty (the phantom-resolution failure mode).
    const cascadeClear = () => {
        types.clear();
        methods.clear();
        fields.clear();
        rawSymbols.clear();
        attachedScopes = undefined;
    };
    // Writer-typed facade: exposes reads + add, but NO `clear` field.
    // Callers holding a `SemanticModel.symbols` reference cannot desync
    // the leaf indexes from the owner-scoped registries. Consumers that
    // only query should widen their annotation to SymbolTableReader for
    // least-authority clarity.
    const symbols = {
        add: wrappedAdd,
        lookupExact: rawSymbols.lookupExact,
        lookupExactFull: rawSymbols.lookupExactFull,
        lookupExactAll: rawSymbols.lookupExactAll,
        lookupCallableByName: rawSymbols.lookupCallableByName,
        getFiles: rawSymbols.getFiles,
        getStats: rawSymbols.getStats,
    };
    return {
        types,
        methods,
        fields,
        symbols,
        get scopes() {
            return attachedScopes;
        },
        clear: cascadeClear,
        attachScopeIndexes,
    };
};
