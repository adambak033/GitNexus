/**
 * Standard import path resolution.
 * Handles relative imports, path alias rewriting, and generic suffix matching.
 * Used as the fallback when language-specific resolvers don't match.
 */
import type { SuffixIndex } from './utils.js';
import { SupportedLanguages } from '../../../_shared/index.js';
import type { ImportResult, ImportResolverStrategy, ResolveCtx } from './types.js';
import type { TsconfigPaths } from '../language-config.js';
/** Max entries in the resolve cache. Beyond this, entries are evicted.
 *  100K entries ≈ 15MB — covers the most common import patterns. */
export declare const RESOLVE_CACHE_CAP = 100000;
/**
 * Resolve an import path to a file path in the repository.
 *
 * Language-specific preprocessing is applied before the generic resolution:
 * - TypeScript/JavaScript: rewrites tsconfig path aliases
 * - Rust: converts crate::/super::/self:: to relative paths
 *
 * Java wildcards and Go package imports are handled by the scope-resolution
 * phase because they resolve to multiple files.
 */
export declare const resolveImportPath: (currentFile: string, importPath: string, allFiles: Set<string>, allFileList: readonly string[], normalizedFileList: readonly string[], resolveCache: Map<string, string | null>, language: SupportedLanguages, tsconfigPaths: TsconfigPaths | null, index?: SuffixIndex) => string | null;
/**
 * Standard single-file resolution (TS/JS/C/C++ and fallback for other languages).
 * Handles relative imports, tsconfig path aliases, and suffix matching.
 */
export declare function resolveStandard(rawImportPath: string, filePath: string, ctx: ResolveCtx, language: SupportedLanguages): ImportResult;
/** Create a reusable standard-resolution strategy for a given language. */
export declare function createStandardStrategy(language: SupportedLanguages): ImportResolverStrategy;
/**
 * Strip a JS-family extension from a path, returning the stem.
 * Returns `null` if the path does not end with a JS-family extension.
 */
export declare function stripJsExtension(path: string): string | null;
