/**
 * Resolution Context
 *
 * Single implementation of tiered name resolution.
 *
 * Resolution tiers (highest confidence first):
 * 1. Same file (lookupExactAll — authoritative)
 * 2a-named. Named binding chain (walkBindingChain via NamedImportMap)
 * 2a. Import-scoped (iterate importedFiles with lookupExactAll per file)
 * 2b. Package-scoped (iterate indexed files matching package dir with lookupExactAll)
 * 3. Global (lookupClassByName + lookupImplByName + lookupCallableByName — consumers must check count)
 *
 * Each tier queries the minimum necessary scope directly:
 * - Tier 2a iterates the caller's import set (O(imports) × O(1) lookupExactAll).
 * - Tier 2b iterates all indexed files filtered by package dir
 *   (O(files) × O(1) lookupExactAll — avoids a global name scan).
 * - Tier 3 combines lookupClassByName + lookupImplByName + lookupCallableByName
 *   (three O(1) index lookups with a narrow, type-specific result set).
 */
import { createSemanticModel } from './semantic-model.js';
/**
 * Check if a file path is directly inside a package directory identified by
 * its suffix. Used by Tier 2b package-scoped resolution (Go / C#).
 */
export function isFileInPackageDir(filePath, dirSuffix) {
    // Prepend '/' so paths like "internal/auth/service.go" match suffix "/internal/auth/"
    const normalized = '/' + filePath.replace(/\\/g, '/');
    if (!normalized.includes(dirSuffix))
        return false;
    const afterDir = normalized.substring(normalized.indexOf(dirSuffix) + dirSuffix.length);
    return !afterDir.includes('/');
}
/** Maximum re-export hops walkBindingChain will follow before giving up.
 *  A hard cap is needed to defend against pathological cycles that slip
 *  past the `visited` Set (e.g. a binding chain whose key is equal by
 *  string value but visits distinct modules). Five hops covers the
 *  common TypeScript monorepo pattern (component → pkg/index →
 *  packages/index → root/index → types/index). Chains longer than this
 *  fall through to Tier 2a-import / Tier 2b / Tier 3 resolution, which
 *  is a silent false-negative that the caller may or may not recover
 *  from. If a real repo hits this limit, raise it — there is no
 *  correctness reason to keep it at exactly 5. */
const MAX_BINDING_CHAIN_DEPTH = 5;
/**
 * Walk a named-binding re-export chain through NamedImportMap.
 *
 * When file A imports { User } from B, and B re-exports { User } from C,
 * the NamedImportMap for A points to B, but B has no User definition.
 * This function follows the chain: A → B → C until a definition is found.
 *
 * Returns the definitions found at the end of the chain, or null if the
 * chain breaks (missing binding, circular reference, or
 * {@link MAX_BINDING_CHAIN_DEPTH} exceeded). Internal to
 * resolution-context — not exported from the model barrel.
 */
function walkBindingChain(name, currentFilePath, symbolTable, namedImportMap) {
    // Fast exit: most files have no named imports at all. Skip the Set
    // allocation + loop entry on the common empty-binding path so resolve()
    // stays allocation-free for the typical call site.
    const firstBindings = namedImportMap.get(currentFilePath);
    if (!firstBindings)
        return null;
    const firstBinding = firstBindings.get(name);
    if (!firstBinding)
        return null;
    let lookupFile = currentFilePath;
    let lookupName = name;
    const visited = new Set();
    for (let depth = 0; depth < MAX_BINDING_CHAIN_DEPTH; depth++) {
        const bindings = depth === 0 ? firstBindings : namedImportMap.get(lookupFile);
        if (!bindings)
            return null;
        const binding = depth === 0 ? firstBinding : bindings.get(lookupName);
        if (!binding)
            return null;
        const key = `${binding.sourcePath}:${binding.exportedName}`;
        if (visited.has(key))
            return null; // circular
        visited.add(key);
        const targetName = binding.exportedName;
        const resolvedDefs = symbolTable.lookupExactAll(binding.sourcePath, targetName);
        if (resolvedDefs.length > 0)
            return resolvedDefs;
        // No definition in source file → follow re-export chain
        lookupFile = binding.sourcePath;
        lookupName = targetName;
    }
    return null;
}
/** Confidence scores per resolution tier. */
export const TIER_CONFIDENCE = {
    'same-file': 0.95,
    'import-scoped': 0.9,
    global: 0.5,
};
export const createResolutionContext = () => {
    const model = createSemanticModel();
    const symbols = model.symbols;
    const importMap = new Map();
    const packageMap = new Map();
    const namedImportMap = new Map();
    const moduleAliasMap = new Map();
    // Inverted index: packageDirSuffix → Set<filePath>.
    // Built lazily on first Tier 2b hit — one-time cost of O(totalFiles ×
    // allUniqueDirSuffixes) isFileInPackageDir calls across the entire
    // packageMap, amortized over the pipeline run. Subsequent Tier 2b
    // resolutions are O(callerPackages × filesInPackage × O(1)).
    let packageDirIndex = null;
    // Per-file cache state
    let cacheFile = null;
    let cache = null;
    let cacheHits = 0;
    let cacheMisses = 0;
    // Tier hit counters — replaces the lost fuzzyCallCount diagnostic
    let tierSameFile = 0;
    let tierImportScoped = 0;
    let tierGlobal = 0;
    let tierMiss = 0;
    // --- Core resolution (single implementation of tier logic) ---
    const resolveUncached = (name, fromFile) => {
        // Tier 1: Same file — authoritative match (returns all overloads)
        const localDefs = symbols.lookupExactAll(fromFile, name);
        if (localDefs.length > 0) {
            tierSameFile++;
            return { candidates: localDefs, tier: 'same-file' };
        }
        // Tier 2a-named: Named binding chain (aliased / re-exported imports)
        // Checked before import-scoped so that `import { User as U }` resolves
        // correctly even when lookupExactAll on the alias name returns nothing.
        const chainResult = walkBindingChain(name, fromFile, symbols, namedImportMap);
        if (chainResult && chainResult.length > 0) {
            tierImportScoped++;
            return { candidates: chainResult, tier: 'import-scoped' };
        }
        // Tier 2a: Import-scoped — iterate the caller's imported files directly.
        // O(importedFiles) × O(1) lookupExactAll — no global name scan needed.
        const importedFiles = importMap.get(fromFile);
        if (importedFiles) {
            const importedDefs = [];
            for (const file of importedFiles) {
                importedDefs.push(...symbols.lookupExactAll(file, name));
            }
            if (importedDefs.length > 0) {
                tierImportScoped++;
                return { candidates: importedDefs, tier: 'import-scoped' };
            }
        }
        // Tier 2b: Package-scoped — look up files in the caller's imported package
        // directories via an inverted index (packageDirSuffix → Set<filePath>),
        // then do O(1) lookupExactAll per file. The inverted index is built lazily
        // on first Tier 2b hit by scanning symbols.getFiles() once, making
        // subsequent Tier 2b resolutions O(packages × filesInPackage) instead of
        // O(allFiles × packages).
        const importedPackages = packageMap.get(fromFile);
        if (importedPackages) {
            // Lazily build the inverted index on first use. For each indexed file,
            // test it against isFileInPackageDir for all known dirSuffixes collected
            // from packageMap. This scans all files once (instead of per-resolution)
            // and produces a dirSuffix → Set<filePath> map.
            if (!packageDirIndex) {
                // Collect all unique dir suffixes across the entire packageMap
                const allDirSuffixes = new Set();
                for (const dirs of packageMap.values()) {
                    for (const d of dirs)
                        allDirSuffixes.add(d);
                }
                packageDirIndex = new Map();
                for (const file of symbols.getFiles()) {
                    for (const dirSuffix of allDirSuffixes) {
                        if (isFileInPackageDir(file, dirSuffix)) {
                            let files = packageDirIndex.get(dirSuffix);
                            if (!files) {
                                files = new Set();
                                packageDirIndex.set(dirSuffix, files);
                            }
                            files.add(file);
                        }
                    }
                }
            }
            const packageDefs = [];
            for (const dirSuffix of importedPackages) {
                const filesInDir = packageDirIndex.get(dirSuffix);
                if (filesInDir) {
                    for (const file of filesInDir) {
                        packageDefs.push(...symbols.lookupExactAll(file, name));
                    }
                }
            }
            if (packageDefs.length > 0) {
                tierImportScoped++;
                return { candidates: packageDefs, tier: 'import-scoped' };
            }
        }
        // Tier 3: Global — targeted O(1) index lookups for each symbol category.
        // Class-like symbols (Class, Struct, Interface, Enum, Record, Trait) are
        // covered by lookupClassByName; Rust impl blocks by lookupImplByName
        // (separate to avoid polluting heritage resolution); free callables
        // (Function, Macro, Delegate) by lookupCallableByName; owner-scoped
        // methods and constructors by `model.methods.lookupMethodByName`.
        //
        // FREE_CALLABLE_TYPES excludes Method/Constructor, so strictly-labeled
        // methods are disjoint between the two indexes.
        //
        // Partial-state caveat: Python/Rust/Kotlin class methods are emitted
        // as Function + ownerId — `rawSymbols.add` routes them through both
        // the Function callable index AND, via the dispatch-key normalization
        // in `wrappedAdd`, the method registry. The same `SymbolDefinition`
        // reference lands in both `callableDefs` and `methodDefs`, so the
        // Set-based dedup below is required.
        //
        // Known exclusion: TypeAlias, Const, and Variable are NOT reachable at
        // Tier 3 — they don't belong to any of the indexes. TypeAlias is not
        // a call target; Const/Variable are resolved via import or same-file
        // tiers. Macro (C/C++) and Delegate (C#) stay in the callable index
        // since call-processor.ts treats them as callable targets.
        const classDefs = model.types.lookupClassByName(name);
        const implDefs = model.types.lookupImplByName(name);
        const callableDefs = symbols.lookupCallableByName(name);
        const methodDefs = model.methods.lookupMethodByName(name);
        if (classDefs.length === 0 &&
            implDefs.length === 0 &&
            callableDefs.length === 0 &&
            methodDefs.length === 0) {
            tierMiss++;
            return null;
        }
        // Fast path: if no `Function + ownerId` class method was ever
        // registered into the method registry (the only source of
        // cross-index duplication), the callable and method indexes are
        // guaranteed disjoint and we can concat without dedup.
        if (!model.methods.hasFunctionMethods) {
            const globalDefs = [
                ...classDefs,
                ...implDefs,
                ...callableDefs,
                ...methodDefs,
            ];
            tierGlobal++;
            return { candidates: globalDefs, tier: 'global' };
        }
        // Slow path: dedup by nodeId because the same SymbolDefinition
        // reference can land in both `callableDefs` (via the Function
        // callable-index gate) and `methodDefs` (via the dispatch-key
        // normalization routing Function+ownerId into MethodRegistry).
        // Dedup covers all four index reads so any nodeId overlap (even
        // theoretical ones between classDefs/implDefs) is caught.
        const globalDefs = [];
        const seen = new Set();
        const pushUnique = (pool) => {
            for (const def of pool) {
                if (seen.has(def.nodeId))
                    continue;
                seen.add(def.nodeId);
                globalDefs.push(def);
            }
        };
        pushUnique(classDefs);
        pushUnique(implDefs);
        pushUnique(callableDefs);
        pushUnique(methodDefs);
        tierGlobal++;
        return { candidates: globalDefs, tier: 'global' };
    };
    const resolve = (name, fromFile) => {
        // Check cache (only when enabled AND fromFile matches cached file)
        if (cache && cacheFile === fromFile) {
            if (cache.has(name)) {
                cacheHits++;
                return cache.get(name);
            }
            cacheMisses++;
        }
        const result = resolveUncached(name, fromFile);
        // Store in cache if active and file matches
        if (cache && cacheFile === fromFile) {
            cache.set(name, result);
        }
        return result;
    };
    // --- Cache lifecycle ---
    const enableCache = (filePath) => {
        cacheFile = filePath;
        if (!cache)
            cache = new Map();
        else
            cache.clear();
    };
    const clearCache = () => {
        cacheFile = null;
        // Reuse the Map instance — just clear entries to reduce GC pressure at scale.
        cache?.clear();
        // Note: packageDirIndex is NOT invalidated here. It is built lazily on
        // first Tier 2b hit and remains valid across file boundaries because
        // packageMap and the symbol file set are append-only during the calls
        // phase (all parsing/import processing completes before resolution).
        // Invalidating per-file would destroy the amortization benefit — the
        // O(files × dirs) rebuild would run per-file instead of once.
        // Full invalidation happens in clear() (pipeline reset).
    };
    const getStats = () => ({
        ...symbols.getStats(),
        cacheHits,
        cacheMisses,
        tierSameFile,
        tierImportScoped,
        tierGlobal,
        tierMiss,
    });
    const clear = () => {
        model.clear();
        importMap.clear();
        packageMap.clear();
        namedImportMap.clear();
        moduleAliasMap.clear();
        packageDirIndex = null; // invalidate — will rebuild on next Tier 2b hit
        clearCache();
        cacheHits = 0;
        cacheMisses = 0;
        tierSameFile = 0;
        tierImportScoped = 0;
        tierGlobal = 0;
        tierMiss = 0;
    };
    return {
        resolve,
        model,
        importMap,
        packageMap,
        namedImportMap,
        moduleAliasMap,
        enableCache,
        clearCache,
        getStats,
        clear,
    };
};
