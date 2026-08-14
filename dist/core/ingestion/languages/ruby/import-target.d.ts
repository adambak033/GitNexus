/**
 * Resolve a Ruby require/require_relative import path to a repo-relative file.
 *
 * Ruby import resolution rules:
 *   - `require_relative './foo'` → resolve relative to the importing file's dir
 *   - `require 'foo'`           → suffix-match via the existing Ruby import resolver
 *   - External gems             → null (unresolvable within the repo)
 */
export interface RubyResolveContext {
    readonly fromFile: string;
    readonly allFilePaths: ReadonlySet<string>;
}
/**
 * ScopeResolver-shaped adapter:
 *   `(targetRaw, fromFile, allFilePaths, resolutionConfig?) → string | string[] | null`
 *
 * For relative paths (`./` or `../` — require_relative semantics), resolves
 * against the importing file's directory, trying `.rb` and `/index.rb`
 * suffixes.
 *
 * For bare requires (gem-style like `'json'`, `'serializable'`), delegates
 * to the existing `resolveRubyImportInternal` which uses suffix matching.
 *
 * Returns `null` for external gems that have no matching file in the repo.
 */
export declare function resolveRubyImportTarget(targetRaw: string, fromFile: string, allFilePaths: ReadonlySet<string>, _resolutionConfig?: unknown): string | readonly string[] | null;
