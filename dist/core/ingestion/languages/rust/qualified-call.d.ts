/**
 * Rust module-qualified call resolution (#2730) — path resolution over the
 * module tree, the way rustc does it.
 *
 * `tools::dispatch(ctx, name)` is captured as a FREE call whose `name` is the
 * tail identifier and whose written path rides along in `site.rawQualifiedName`
 * (the same channel #1982 built for qualified inheritance bases). Without
 * consulting that path, the shared scope-chain walk resolves the bare tail and
 * binds it to whatever `dispatch` is lexically nearest — which, for the wrapper
 * idiom `fn dispatch(..) { tools::dispatch(..) }`, is the wrapper itself. The
 * real cross-module edge then does not exist and `impact` reports the callee as
 * unreached.
 *
 * The fix follows rustc's actual rule rather than a filename heuristic:
 *
 *   1. A path's leading segments name MODULES, resolved in the type namespace.
 *      A same-named `fn` lives in the value namespace and therefore can never
 *      shadow them — which is exactly the shadowing this bug was about.
 *   2. `crate::` / `self::` / `super::` are prefix transforms on the caller's
 *      own module path, not reasons to give up.
 *   3. The final segment is a MEMBER of the resolved module — looked up in that
 *      module's binding table, so `pub use` re-exports resolve like any other
 *      binding.
 *
 * Module identity comes from `module-path.ts`: file path below the crate root,
 * plus any enclosing `mod` blocks (carried on `namespacePrefix`, stamped by the
 * shared `tagNamespacePrefixes` pass now that `mod_item` emits a Namespace def).
 *
 * Refuses — returns `undefined`, leaving the shared chain untouched — whenever
 * the path names no known module, the module has no such member, or two
 * candidates tie. A wrong CALLS edge is worse than a missing one: it is what
 * made this issue dangerous in the first place.
 */
import type { ParsedFile, ScopeId, SymbolDefinition } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { WorkspaceResolutionIndex } from '../../scope-resolution/workspace-index.js';
export declare function resolveRustQualifiedFreeCall(site: {
    readonly name: string;
    readonly rawQualifiedName?: string;
    readonly inScope: ScopeId;
}, callerParsed: ParsedFile, scopes: ScopeResolutionIndexes, workspaceIndex: WorkspaceResolutionIndex, allFilePaths: ReadonlySet<string>): SymbolDefinition | undefined;
