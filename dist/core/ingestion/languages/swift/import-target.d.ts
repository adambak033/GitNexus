/**
 * `resolveImportTarget` adapter for the Swift `ScopeResolver`.
 *
 * Swift's `import ModuleName` brings in a whole SPM target / framework
 * module. The scope-resolution contract passes only `allFilePaths` (no
 * `SwiftPackageConfig`), so we resolve a module name to the `.swift`
 * files under a directory segment named after the module — the SPM
 * convention `Sources/<Module>/*.swift` (and the common
 * `<Module>/*.swift` layout). This needs no manifest parsing.
 *
 * Same-module (intra-target) visibility — the bulk of Swift cross-file
 * resolution, which needs NO `import` statement — is handled separately
 * by `populateSwiftTargetSiblings` (see `target-siblings.ts`). This
 * adapter only resolves EXPLICIT `import` statements (cross-module).
 *
 * Returns all matching files (one ImportEdge per file, like Go's
 * package resolver) so every exported symbol in the module materializes
 * a binding. Returns `null` for external frameworks (Foundation, UIKit,
 * …) that have no in-repo directory.
 *
 * Performance: the directory→files grouping is memoized on the stable
 * `allFilePaths` Set identity (the same Set is threaded to every import
 * in a run), so it is built once per run — NOT once per import. Mirrors
 * Python's `getPythonFileIndex` WeakMap pattern (PR #1918).
 */
import type { ParsedImport, WorkspaceIndex } from '../../../../_shared/index.js';
export interface SwiftResolveContext {
    readonly fromFile: string;
    /** `ReadonlySet` so the orchestrator's stable run-level set flows
     *  straight through to the memoized index key. */
    readonly allFilePaths: ReadonlySet<string>;
}
export declare function resolveSwiftImportTarget(parsedImport: ParsedImport, workspaceIndex: WorkspaceIndex): string | readonly string[] | null;
