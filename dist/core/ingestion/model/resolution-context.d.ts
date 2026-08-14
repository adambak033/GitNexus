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
import type { SymbolDefinition } from '../../../_shared/index.js';
import type { MutableSemanticModel } from './semantic-model.js';
/**
 * A single named binding in a source file (e.g. `import { User as U }`).
 * Stores both the resolved source path and the original exported name so
 * that aliased imports can resolve U → User in the source file.
 */
export interface NamedImportBinding {
    sourcePath: string;
    exportedName: string;
}
/**
 * Map<ImportingFilePath, Map<LocalName, NamedImportBinding>>.
 *
 * Tracks which specific names a file imports from which sources (TS / Python
 * / Rust / Java-static / ...). Used to tighten Tier 2a resolution:
 * `import { User } from './models'` means only `User` (not `Repo`) is
 * visible from models.ts via this import.
 */
export type NamedImportMap = Map<string, Map<string, NamedImportBinding>>;
/**
 * Check if a file path is directly inside a package directory identified by
 * its suffix. Used by Tier 2b package-scoped resolution (Go / C#).
 */
export declare function isFileInPackageDir(filePath: string, dirSuffix: string): boolean;
/** Resolution tier for tracking, logging, and test assertions. */
export type ResolutionTier = 'same-file' | 'import-scoped' | 'global';
/** Tier-selected candidates with metadata. */
export interface TieredCandidates {
    readonly candidates: readonly SymbolDefinition[];
    readonly tier: ResolutionTier;
}
/** Confidence scores per resolution tier. */
export declare const TIER_CONFIDENCE: Record<ResolutionTier, number>;
export type ImportMap = Map<string, Set<string>>;
export type PackageMap = Map<string, Set<string>>;
/** Maps callerFile → (moduleAlias → sourceFilePath) for Python namespace imports.
 *  e.g. `import models` in app.py → moduleAliasMap.get('app.py')?.get('models') === 'models.py' */
export type ModuleAliasMap = Map<string, Map<string, string>>;
export interface ResolutionContext {
    /**
     * The only resolution API. Returns all candidates at the winning tier.
     *
     * Tier 3 ('global') returns ALL candidates regardless of count —
     * consumers must check candidates.length and refuse ambiguous matches.
     */
    resolve(name: string, fromFile: string): TieredCandidates | null;
    /** Semantic model — the top-level container for types, methods, fields,
     *  and the nested file/callable SymbolTable. Typed as
     *  {@link MutableSemanticModel} because `ResolutionContext` is the
     *  lifecycle owner — the pipeline registers symbols through it during
     *  the fan-out phase. Resolvers that only query should annotate their
     *  own fields as {@link SemanticModel} to drop write access. */
    readonly model: MutableSemanticModel;
    /** Raw maps — used by import-processor to populate import data. */
    readonly importMap: ImportMap;
    readonly packageMap: PackageMap;
    readonly namedImportMap: NamedImportMap;
    /** Module-alias map for Python namespace imports: callerFile → (alias → sourceFile). */
    readonly moduleAliasMap: ModuleAliasMap;
    enableCache(filePath: string): void;
    clearCache(): void;
    getStats(): {
        fileCount: number;
        cacheHits: number;
        cacheMisses: number;
        tierSameFile: number;
        tierImportScoped: number;
        tierGlobal: number;
        tierMiss: number;
    };
    clear(): void;
}
export declare const createResolutionContext: () => ResolutionContext;
