/**
 * Cross-file return-type typeBinding propagation + post-finalize
 * chain re-follow.
 *
 * **Why this lives in scope-resolution:** the algorithm is language-agnostic.
 * Every language with cross-file callable imports needs the same
 * mirror-binding step, otherwise `u = f(); u.save()` only resolves
 * when `f` is in the same file as the call.
 *
 * **Mutation contract (Contract Invariant I3 + I6):**
 *   - Mutates `Scope.typeBindings` (a plain `new Map(...)` from
 *     `draftToScope`, NOT frozen — intentional, do not freeze).
 *   - MUST run AFTER `finalizeScopeModel` (so `indexes.bindings` is
 *     populated) but BEFORE `resolveReferenceSites` (so resolution
 *     sees the propagated types).
 *
 * **Ordering invariant (added 2026-04-24, RFC #909 Ring 3 / PR #1050):**
 * The pass walks files in `indexes.sccs` reverse-topological order
 * (leaves first per `tarjanSccs`). For each importer we chain-follow
 * the source module's typeBindings BEFORE mirroring, so a multi-hop
 * alias chain like
 *
 *   models.ts: function getUser(): User
 *   service.ts: export const user = getUser()        // user → getUser
 *   app.ts: import { user } from './service'         // user → ?
 *
 * collapses to `app.user → User` in a single pass instead of stopping
 * at the intermediate `getUser` ref. The motivating regression is the
 * `ts-simple` integration fixture (`gitnexus/test/fixtures/scope-
 * resolution/cross-file-binding/ts-simple/`), where `user.save()` and
 * `user.getName()` only resolve when the chain collapse happens
 * topologically.
 *
 * Cyclic SCCs reach a partial fixpoint via the same mirror step but
 * are not guaranteed to fully resolve — see the `ts-circular`
 * fixture, which only asserts pipeline-no-throw.
 *
 * Generic; promoted from `languages/python/scope-resolver.ts` per the
 * scope-resolution generalization plan.
 */
import type { ParsedFile, ScopeId, TypeRef } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { WorkspaceResolutionIndex } from '../workspace-index.js';
/** Walk `ref.rawName` through the scope chain's typeBindings looking
 *  for a terminal class-like rawName. Mirrors the in-extractor
 *  `followChainedRef` but operates on post-finalize Scope objects so
 *  it can see imported return-types propagated by
 *  `propagateImportedReturnTypes`. */
export declare function followChainPostFinalize(start: TypeRef, fromScopeId: ScopeId, scopes: ScopeResolutionIndexes): TypeRef;
/**
 * Copy return-type typeBindings across module boundaries via import
 * bindings. For each module-scope import like `from x import f`, look
 * up `f` in the source file's module-scope typeBindings (which carries
 * `f → ReturnType` from the language's return-type annotation
 * capture) and mirror that binding into the importer's module scope.
 *
 * After propagation, re-runs the chain-follow on every scope's
 * typeBindings — the in-extractor pass-4 ran before propagation and
 * missed any chain whose terminal lived in a foreign file.
 *
 * Scope-chain concern (verified 2026-04-21): `pythonImportOwningScope`
 * documents that function-local `from x import y` binds `y` to the
 * inner function scope, which would make a module-only write miss
 * non-module importers. In practice `finalize-algorithm` hoists those
 * bindings into `indexes.bindings[moduleScope]` regardless of where
 * the `import` statement appears — the integration fixture
 * `python-function-local-import-chain` exercises a chained
 * receiver-bound call `u = get_user(); u.save()` inside a function
 * body and emits the expected `do_work → User.save` edge. The
 * module-scope write is sufficient today. If finalize routing ever
 * changes to honor the hook's per-scope contract, this pass must
 * iterate `indexes.bindings` over every scope and mirror into the
 * binding-owning scope's `typeBindings`, not just the module's.
 */
export declare function propagateImportedReturnTypes(parsedFiles: readonly ParsedFile[], indexes: ScopeResolutionIndexes, index: WorkspaceResolutionIndex): void;
