import type { ParsedFile } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
export declare function populateRustRangeBindings(parsedFiles: readonly ParsedFile[], indexes: ScopeResolutionIndexes, ctx: {
    readonly fileContents: ReadonlyMap<string, string>;
    readonly treeCache?: {
        get(filePath: string): unknown;
    };
}): void;
