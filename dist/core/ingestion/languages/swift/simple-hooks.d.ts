/**
 * Trivial / no-op-ish hooks for the Swift provider. Kept together
 * because each is a few lines and they share a theme: they make the
 * provider's choice explicit rather than relying on "absence == default"
 * so reviewers don't have to re-derive the analysis.
 */
import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
/** Swift uses the central extractor's "innermost enclosing scope" default
 *  for most declarations: class-body declarations attach to the Class
 *  scope, function-body locals to the Function scope.
 *
 *  Exception: **function return-type bindings** (`@type-binding.return`)
 *  must hoist to the Module scope. The default auto-hoist promotes only
 *  one level (Function → its parent). For top-level functions the parent
 *  is already the Module so the default works, but for methods declared
 *  inside a class/struct/extension the parent is the Class — the return
 *  binding would get stuck there, invisible to:
 *    - chain-follow's parent-chain walk (`let u = getUser(); u.save()`);
 *    - cross-file `propagateImportedReturnTypes`, which reads only
 *      `sourceModule.typeBindings`.
 *  Walking to Module restores both. Mirrors `csharpBindingScopeFor`. */
export declare function swiftBindingScopeFor(decl: CaptureMatch, innermost: Scope, tree: ScopeTree): ScopeId | null;
/** Swift imports only appear at file (module) scope and bring a whole
 *  module into view there. Attach the import to the Module scope; for any
 *  other innermost scope delegate to the default (returns null). */
export declare function swiftImportOwningScope(_imp: ParsedImport, innermost: Scope, _tree: ScopeTree): ScopeId | null;
/** Look up `self` (or `super`) in the function scope's type bindings.
 *
 *  `self` / `super` are synthesized as type bindings on instance methods
 *  during capture emission (`receiver-binding.ts`) — `self` for every
 *  method inside a class/struct/extension/protocol body, and `super`
 *  additionally for methods of a class with a declared superclass. This
 *  hook returns a non-null `TypeRef` for instance-method bodies.
 *
 *  Returns `null` for static methods (no `self` synthesized), free
 *  functions (no enclosing type), and non-Function scopes. */
export declare function swiftReceiverBinding(functionScope: Scope): TypeRef | null;
