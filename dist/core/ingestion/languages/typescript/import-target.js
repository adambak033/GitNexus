/**
 * Adapter from `(ParsedImport, WorkspaceIndex)` → concrete file path.
 *
 * Delegates to `module-resolution.ts`, which runs the algorithm `tsc` and Node
 * actually run. It used to delegate to the shared `resolveImportPath`, whose
 * final step was `suffixResolve` — a repo-wide search for any file path ending
 * in the specifier. That is what #2953 removed: this path now resolves only
 * against declared inputs (real paths, tsconfig `paths`/`baseUrl`, package
 * manifests) and answers `null` for everything else.
 *
 * The `WorkspaceIndex` is opaque at the shared contract layer; we narrow it to
 * a TypeScript-shaped context carrying `fromFile`, the workspace file set, and
 * the two config indexes the algorithm reads.
 *
 * Returning `null` lets the finalize algorithm mark the edge as
 * `linkStatus: 'unresolved'` — which for an external package is the correct
 * and complete answer.
 */
import { resolveTsModule } from './module-resolution.js';
export function resolveTsImportTarget(parsedImport, workspaceIndex) {
    const ctx = narrowTsContext(workspaceIndex);
    if (ctx === null)
        return null;
    // Dynamic imports carry `targetRaw` only for diagnostics; when the
    // expression isn't a string literal we can't resolve a file.
    // A string-literal dynamic import (`import('./m')`) resolves like a
    // static import — fall through to the shared path resolver.
    if (parsedImport.kind === 'dynamic-unresolved' && parsedImport.targetRaw === null)
        return null;
    if (parsedImport.targetRaw === null || parsedImport.targetRaw === '')
        return null;
    return resolveTsTarget(parsedImport.targetRaw, ctx);
}
/**
 * Resolve a raw module-path string to a workspace file path. Operates directly
 * on the source string without requiring a `ParsedImport`, so the
 * `ScopeResolver.resolveImportTarget` adapter doesn't need to construct a fake
 * one to reach the resolver.
 *
 * Returns `null` when `targetRaw` is empty, names an external package, or names
 * something no declared config maps into the repo.
 */
export function resolveTsTarget(targetRaw, ctx) {
    return resolveTsModule(targetRaw, {
        fromFile: ctx.fromFile,
        allFilePaths: ctx.allFilePaths,
        tsconfigs: ctx.tsconfigs ?? null,
        workspacePackages: ctx.nodeWorkspacePackages ?? null,
    });
}
function narrowTsContext(workspaceIndex) {
    const ctx = workspaceIndex;
    if (ctx === undefined ||
        typeof ctx.fromFile !== 'string' ||
        !(ctx.allFilePaths instanceof Set)) {
        return null;
    }
    return ctx;
}
