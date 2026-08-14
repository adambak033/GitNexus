import type { ParsedFile } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
/**
 * O(n²×d) where n = files per package, d = defs per file.
 * Acceptable for V1 since Go packages are typically small (< 20 files).
 * Future optimization: build a name→def inverted index per package to reduce
 * to O(n×d).
 */
export declare function populateGoPackageSiblings(parsedFiles: readonly ParsedFile[], indexes: ScopeResolutionIndexes, ctx: {
    readonly fileContents: ReadonlyMap<string, string>;
}): void;
