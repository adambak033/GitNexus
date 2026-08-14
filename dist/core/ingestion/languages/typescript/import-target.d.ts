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
import type { ParsedImport, WorkspaceIndex } from '../../../../_shared/index.js';
import type { NodeWorkspacePackages } from '../../import-resolvers/node-workspace-packages.js';
import type { TsconfigIndex } from './tsconfig.js';
export interface TsResolveContext {
    readonly fromFile: string;
    /** The workspace file set. */
    readonly allFilePaths: ReadonlySet<string>;
    /** Every tsconfig in the repo; `null` when the repo declares none. */
    readonly tsconfigs?: TsconfigIndex | null;
    /** Every in-repo `package.json`; `null` when the repo declares none. */
    readonly nodeWorkspacePackages?: NodeWorkspacePackages | null;
}
export declare function resolveTsImportTarget(parsedImport: ParsedImport, workspaceIndex: WorkspaceIndex): string | null;
/**
 * Resolve a raw module-path string to a workspace file path. Operates directly
 * on the source string without requiring a `ParsedImport`, so the
 * `ScopeResolver.resolveImportTarget` adapter doesn't need to construct a fake
 * one to reach the resolver.
 *
 * Returns `null` when `targetRaw` is empty, names an external package, or names
 * something no declared config maps into the repo.
 */
export declare function resolveTsTarget(targetRaw: string, ctx: TsResolveContext): string | null;
