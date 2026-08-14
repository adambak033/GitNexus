import type { ParsedFile } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
/**
 * Populate range-for loop variable type bindings for C++.
 *
 * Handles three patterns:
 *   1. `for (auto& user : users)` — simple range-for
 *   2. `for (auto& [key, user] : userMap)` — structured binding
 *   3. `for (auto& user : *usersPtr)` — dereference range-for
 *
 * Strategy: look up the range source variable's type in scope
 * typeBindings, extract the last template argument as the element
 * type, and inject a typeBinding for the loop variable.
 */
export declare function populateCppRangeBindings(parsedFiles: readonly ParsedFile[], _indexes: ScopeResolutionIndexes, ctx: {
    readonly fileContents: ReadonlyMap<string, string>;
    readonly treeCache?: {
        get(filePath: string): unknown;
    };
}): void;
