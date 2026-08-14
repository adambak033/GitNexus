import type { ParsedFile } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
export declare function populateGoRangeBindings(parsedFiles: readonly ParsedFile[], _indexes: ScopeResolutionIndexes, ctx: {
    readonly fileContents: ReadonlyMap<string, string>;
    readonly treeCache?: {
        get(filePath: string): unknown;
    };
}): void;
