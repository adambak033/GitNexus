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
export const CLASS_TYPES_TUPLE = [
    'Class',
    'Struct',
    'Interface',
    'Enum',
    'Record',
    'Trait',
];
export const CLASS_TYPES = new Set(CLASS_TYPES_TUPLE);
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
export const FREE_CALLABLE_TUPLE = [
    'Function',
    'Macro', // C/C++
    'Delegate', // C#
];
export const FREE_CALLABLE_TYPES = new Set(FREE_CALLABLE_TUPLE);
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
export const CALL_TARGET_TYPES = new Set([
    ...FREE_CALLABLE_TYPES,
    'Method',
    'Constructor',
]);
export const createSymbolTable = () => {
    // 1. File-Specific Index — stores full SymbolDefinition(s) for O(1) lookup.
    // Structure: FilePath -> (SymbolName -> SymbolDefinition[])
    // Array allows overloaded methods (same name, different signatures) to coexist.
    const fileIndex = new Map();
    // 2. Eagerly-populated Callable Index — maintained on add().
    // Structure: SymbolName -> [Callable Definitions]
    // Only Function, Method, Constructor, Macro, Delegate symbols are indexed.
    const callableByName = new Map();
    const add = (filePath, name, nodeId, type, metadata) => {
        const qualifiedName = CLASS_TYPES.has(type)
            ? (metadata?.qualifiedName ?? name)
            : metadata?.qualifiedName;
        const def = {
            nodeId,
            filePath,
            type,
            ...(qualifiedName !== undefined ? { qualifiedName } : {}),
            ...(metadata?.parameterCount !== undefined
                ? { parameterCount: metadata.parameterCount }
                : {}),
            ...(metadata?.requiredParameterCount !== undefined
                ? { requiredParameterCount: metadata.requiredParameterCount }
                : {}),
            ...(metadata?.parameterTypes !== undefined
                ? { parameterTypes: metadata.parameterTypes }
                : {}),
            ...(metadata?.parameterTypeClasses !== undefined
                ? { parameterTypeClasses: metadata.parameterTypeClasses }
                : {}),
            ...(metadata?.returnType !== undefined ? { returnType: metadata.returnType } : {}),
            ...(metadata?.declaredType !== undefined ? { declaredType: metadata.declaredType } : {}),
            ...(metadata?.templateArguments !== undefined
                ? { templateArguments: metadata.templateArguments }
                : {}),
            ...(metadata?.ownerId !== undefined ? { ownerId: metadata.ownerId } : {}),
            ...(metadata?.isDeleted === true ? { isDeleted: true } : {}),
        };
        // A. File Index — unconditional.
        if (!fileIndex.has(filePath)) {
            fileIndex.set(filePath, new Map());
        }
        const fileMap = fileIndex.get(filePath);
        if (!fileMap.has(name)) {
            fileMap.set(name, [def]);
        }
        else {
            fileMap.get(name).push(def);
        }
        // B. Callable Index — gated by FREE_CALLABLE_TYPES.
        //    Note: Property is NOT in FREE_CALLABLE_TYPES, so it never lands here.
        //    This is the single source of truth for callable-index membership;
        //    the higher-layer dispatch table only decides owner-scoped routing.
        //
        //    Fallback: `Method` or `Constructor` without an `ownerId` is an
        //    extractor contract violation (AST-degraded parse, or a buggy
        //    language extractor). The owner-scoped dispatch hook silently
        //    skips such defs because it has no owner to key them under, so
        //    without this fallback they would be invisible at Tier 3 global
        //    resolution. Route them through `callableByName` so they remain
        //    reachable by name — matching pre-dispatch-table behavior.
        const isOrphanedOwnerScoped = (type === 'Method' || type === 'Constructor') && metadata?.ownerId === undefined;
        if (FREE_CALLABLE_TYPES.has(type) || isOrphanedOwnerScoped) {
            const existing = callableByName.get(name);
            if (existing) {
                existing.push(def);
            }
            else {
                callableByName.set(name, [def]);
            }
        }
        return def;
    };
    const lookupExact = (filePath, name) => {
        const defs = fileIndex.get(filePath)?.get(name);
        return defs?.[0]?.nodeId;
    };
    const lookupExactFull = (filePath, name) => {
        const defs = fileIndex.get(filePath)?.get(name);
        return defs?.[0];
    };
    const lookupExactAll = (filePath, name) => {
        return fileIndex.get(filePath)?.get(name) ?? [];
    };
    const lookupCallableByName = (name) => {
        return callableByName.get(name) ?? [];
    };
    /** Returns a live iterator over all indexed file paths (fileIndex.keys()).
     *  The iterator is invalidated if add() changes fileIndex.size during
     *  iteration (ES2015 Map spec). Safe in the current pipeline because all
     *  symbols are added before resolution begins. */
    const getFiles = () => fileIndex.keys();
    const getStats = () => ({
        fileCount: fileIndex.size,
    });
    const clear = () => {
        fileIndex.clear();
        callableByName.clear();
    };
    return {
        add,
        lookupExact,
        lookupExactFull,
        lookupExactAll,
        lookupCallableByName,
        getFiles,
        getStats,
        clear,
    };
};
