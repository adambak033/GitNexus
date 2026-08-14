/**
 * Symbol Table — file-indexed + callable-name symbol storage.
 *
 * This module is a PURE LEAF in the ingestion dependency hierarchy. It owns
 * two orthogonal O(1) indexes:
 *
 *   1. fileIndex      — Map<filePath, Map<name, SymbolDefinition[]>>
 *                       for same-file lookups (Tier 1 resolution)
 *   2. callableByName — Map<name, SymbolDefinition[]>
 *                       for name-keyed callable lookups (Tier 3 widen)
 *
 * SymbolTable deliberately knows NOTHING about the owner-scoped registries
 * (types, methods, fields) that sit above it in the dependency graph. Those
 * registries live in `model/` and depend on SymbolTable, not the other way
 * around. {@link createSemanticModel} composes this pure SymbolTable with the
 * registries and wraps `add()` to fan out registrations into both layers.
 *
 * Dependency direction (strictly enforced):
 *
 *     gitnexus-shared (NodeLabel)       — leaf type
 *          ↑
 *     symbol-table.ts                   — THIS FILE (pure storage)
 *          ↑
 *     model/type-registry.ts, method-registry.ts, field-registry.ts
 *          ↑
 *     model/registration-table.ts       — dispatch table factory
 *          ↑
 *     model/semantic-model.ts           — orchestrator, wraps add()
 *          ↑
 *     model/resolve.ts, call-processor.ts, ...
 *
 * No arrow ever points downward from this file. If you are tempted to
 * import from `./model/` here, you are going the wrong way — move the
 * logic up the dependency chain instead.
 */
import type { NodeLabel, ParameterTypeClass, SymbolDefinition } from '../../../_shared/index.js';
/**
 * Class-like NodeLabels — used for qualifiedName fallback inside
 * `SymbolTable.add()` and (via import into `model/registration-table.ts`)
 * as the single source of truth for which labels route to classHook
 * in the dispatch table.
 *
 * Exported as a `readonly` tuple so that `typeof CLASS_TYPES_TUPLE[number]`
 * yields a precise literal union (`ClassLikeLabel`). The model layer
 * imports this tuple and uses `Record<ClassLikeLabel, 'dispatch'>` in a
 * `satisfies` intersection to enforce at COMPILE TIME that every label
 * listed here is also classified as dispatch in `LABEL_BEHAVIOR`. Adding
 * a new class-like label to this tuple without updating `LABEL_BEHAVIOR`
 * fails TypeScript.
 *
 * Traits are class-like for heritage resolution: PHP `use Trait;`, Rust
 * `impl Trait for Struct`, and Scala traits all contribute methods to the
 * hierarchy of their using/implementing type.
 */
export declare const CLASS_TYPES_TUPLE: readonly ["Class", "Struct", "Interface", "Enum", "Record", "Trait"];
export type ClassLikeLabel = (typeof CLASS_TYPES_TUPLE)[number];
export declare const CLASS_TYPES: ReadonlySet<NodeLabel>;
/** Free-callable labels — single source of truth for "callables that have
 *  NO owner scope". Methods and constructors are owner-scoped and live in
 *  `MethodRegistry`, reached via `model.methods.lookupMethodByName`. Global
 *  by-name resolution consults both indexes (see `model/index.ts`).
 *
 *  Exported as a `readonly` tuple so that `typeof FREE_CALLABLE_TUPLE[number]`
 *  yields a precise literal union (`FreeCallableLabel`). `registration-table.ts`
 *  imports this type and uses `Record<FreeCallableLabel, 'callable-only'>` in
 *  a `satisfies` intersection to enforce at COMPILE TIME that every label
 *  listed here is also classified as `callable-only` in `LABEL_BEHAVIOR`.
 *  Adding a label to this tuple without updating `LABEL_BEHAVIOR` fails
 *  TypeScript.
 *
 *  Partial-state caveat: Python/Rust/Kotlin class methods are emitted by
 *  the worker as `Function` + `ownerId` (not `Method`), so they still land
 *  here via the `Function` entry. Collapsing those three languages onto the
 *  `Method` label is pending a `def.type` preservation decision.
 */
export declare const FREE_CALLABLE_TUPLE: readonly ["Function", "Macro", "Delegate"];
export type FreeCallableLabel = (typeof FREE_CALLABLE_TUPLE)[number];
export declare const FREE_CALLABLE_TYPES: ReadonlySet<NodeLabel>;
/** Symbol types that can be the TARGET of a call in the resolver's kind
 *  filter — superset of {@link FREE_CALLABLE_TYPES} that also admits
 *  owner-scoped methods and constructors pulled in from `MethodRegistry`.
 *
 *  Why the split: `FREE_CALLABLE_TYPES` now has a narrow meaning (free
 *  callables indexed in `callableByName`), but call resolution still
 *  needs to accept Method and Constructor candidates once they have been
 *  unioned in from `model.methods.lookupMethodByName`. The resolver uses
 *  this constant for kind filtering in
 *  `filterCallableCandidates` / `countCallableCandidates`.
 */
export declare const CALL_TARGET_TYPES: ReadonlySet<NodeLabel>;
/**
 * Optional metadata accepted by {@link SymbolTable.add}. Kept as a separate
 * type alias so callers and wrappers can share the same shape.
 */
export interface AddMetadata {
    parameterCount?: number;
    requiredParameterCount?: number;
    parameterTypes?: string[];
    parameterTypeClasses?: ParameterTypeClass[];
    returnType?: string;
    declaredType?: string;
    templateArguments?: string[];
    ownerId?: string;
    qualifiedName?: string;
    isDeleted?: boolean;
}
/**
 * Pure read-only view over the file and callable indexes. Does NOT
 * include `add()` or `clear()`.
 *
 * Used by consumers that only query symbols (resolvers, type-env, field
 * extractors). The interface is strictly observational — holding a
 * `SymbolTableReader` cannot mutate the table in any way.
 *
 * For consumers that also need to register symbols, use
 * {@link SymbolTableWriter}, which extends this interface with `add()`.
 * Neither interface exposes `clear()` — that capability lives on the
 * internal factory return type and is reachable only inside
 * `SemanticModel` via `rawSymbols`.
 *
 * Segregating the observer contract from the mutation contract means
 * callers holding only a Reader can never desync the model.
 */
export interface SymbolTableReader {
    /**
     * High Confidence: Look for a symbol specifically inside a file.
     * Returns the Node ID if found.
     */
    lookupExact: (filePath: string, name: string) => string | undefined;
    /**
     * High Confidence: Look for a symbol in a specific file, returning full definition.
     * Returns first matching definition — use lookupExactAll for overloaded methods.
     */
    lookupExactFull: (filePath: string, name: string) => SymbolDefinition | undefined;
    /**
     * High Confidence: Look for ALL symbols with this name in a specific file.
     * Returns all definitions, including overloaded methods with the same name.
     * The returned array is a view into the live internal index — callers
     * MUST NOT mutate it. Use `readonly` to enforce this at the type level.
     */
    lookupExactAll: (filePath: string, name: string) => readonly SymbolDefinition[];
    /**
     * Look up callable symbols (Function, Macro, Delegate) by name.
     * O(1) via dedicated eagerly-populated index keyed by symbol name.
     * Returned array is a view into the live index — do not mutate.
     */
    lookupCallableByName: (name: string) => readonly SymbolDefinition[];
    /**
     * Iterate all indexed file paths.
     * Used by Tier 2b (package-scoped) resolution to walk files matching a
     * package directory suffix without a global name scan.
     */
    getFiles: () => IterableIterator<string>;
    /**
     * Debugging: See how many files are tracked.
     */
    getStats: () => {
        fileCount: number;
    };
}
/**
 * Writer view — reads + symbol registration. Does NOT include `clear()`.
 *
 * `MutableSemanticModel.symbols` is typed as this interface, so the
 * lifecycle owner can register symbols and query them. Full-model
 * resets flow through `model.clear()`.
 *
 * The cascading `clear()` capability lives exclusively on the internal
 * factory return type ({@link createSymbolTable}) — a private handle
 * held only by `SemanticModel` via `rawSymbols`.
 */
export interface SymbolTableWriter extends SymbolTableReader {
    /**
     * Register a symbol in the file and (if callable) name-keyed indexes.
     *
     * Returns the constructed {@link SymbolDefinition} so higher-layer
     * wrappers (e.g. `createSemanticModel`) can reuse it without rebuilding
     * the def. This keeps the fan-out in one allocation.
     */
    add: (filePath: string, name: string, nodeId: string, type: NodeLabel, metadata?: AddMetadata) => SymbolDefinition;
}
/**
 * Internal return type for {@link createSymbolTable} — extends the
 * writer with `clear()`. This capability is intentionally NOT exported
 * as a named interface; consumers should hold a `SymbolTableReader` or
 * `SymbolTableWriter` instead.
 *
 * `SemanticModel`'s constructor is the only caller of `createSymbolTable`,
 * and it retains the returned handle as the private `rawSymbols`
 * reference so `cascadeClear` can reach `clear()`. Every other consumer
 * receives the narrower `SymbolTableWriter` facade on `model.symbols`.
 */
interface InternalSymbolTable extends SymbolTableWriter {
    /**
     * Cleanup memory. Clears only the file and callable indexes owned here —
     * owner-scoped registries are cleared by their respective owners via
     * `model.clear()`.
     */
    clear: () => void;
}
export declare const createSymbolTable: () => InternalSymbolTable;
export {};
