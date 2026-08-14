/**
 * Trivial / no-op-ish hooks for the PHP provider. Made explicit so
 * reviewers don't have to re-derive the analysis from "absence == default".
 */
import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
/**
 * PHP method return-type bindings (`@type-binding.return`) must hoist
 * to the enclosing Module scope so `propagateImportedReturnTypes` can
 * mirror them across files. Without this hoist, the return binding gets
 * stuck at the Class scope and is invisible to the cross-file propagation
 * pass that reads only `sourceModule.typeBindings`.
 *
 * All other bindings delegate to the default "innermost scope" rule.
 */
export declare function phpBindingScopeFor(decl: CaptureMatch, innermost: Scope, tree: ScopeTree): ScopeId | null;
/**
 * Determine which scope owns a `use` import declaration.
 *
 *   - `use` inside `namespace Foo { }` → attach to that Namespace scope.
 *   - Top-level `use` (no enclosing namespace) → innermost (Module).
 *   - `use TraitName;` inside a class body → this is a trait-use
 *     (heritage), NOT a namespace import. The grammar emits
 *     `use_declaration` for trait-use (distinct from
 *     `namespace_use_declaration`). Our query only captures
 *     `namespace_use_declaration`, so trait-use never reaches this hook
 *     in practice. Returning `null` here is a safety fallback.
 */
export declare function phpImportOwningScope(_imp: ParsedImport, innermost: Scope, _tree: ScopeTree): ScopeId | null;
/**
 * Look up `$this` or `parent` in the function scope's type bindings.
 *
 * Both are synthesized as `@type-binding.self` captures during capture
 * emission (`receiver-binding.ts`) — `$this` for every non-static
 * method inside a class/trait/interface/enum body, `parent` additionally
 * for class methods with an explicit `base_clause`.
 *
 * Returns `null` for:
 *   - static methods (no `$this` synthesized)
 *   - free functions (no enclosing class)
 *   - non-Function scopes
 */
export declare function phpReceiverBinding(functionScope: Scope): TypeRef | null;
