/**
 * Trivial / no-op-ish hooks for the Python provider. Kept together
 * because each is a few lines and they share a common theme: they exist
 * to make the provider's choice explicit (rather than relying on
 * "absence == default") so reviewers don't have to re-derive the
 * analysis.
 */
import type { CaptureMatch, NodeLabel, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
import type { SyntaxNode } from 'tree-sitter';
export declare function pythonFunctionDefinitionLabel(functionNode: SyntaxNode, defaultLabel: NodeLabel): NodeLabel;
/** Python has no block scope, so the central extractor's "innermost
 *  enclosing scope" default is already correct for ordinary bindings.
 *  Constructor-injected instance fields are the exception: their marker is
 *  anchored inside `__init__`, but compound receiver resolution needs the
 *  field type on the enclosing Class scope. */
export declare function pythonBindingScopeFor(decl: CaptureMatch, innermost: Scope, tree: ScopeTree): ScopeId | null;
/** Function-local `from x import Y` should attach the binding to the
 *  function scope, not the module. Class-body imports (rare but legal —
 *  `class A: import x` makes `x` a class attribute) attach to the class.
 *  Module-level imports delegate to the central default. */
export declare function pythonImportOwningScope(_imp: ParsedImport, innermost: Scope, _tree: ScopeTree): ScopeId | null;
/** Look up `self` or `cls` in the function scope's type bindings.
 *  Returns `null` for free functions (no `self`/`cls`) and for
 *  non-Function scopes. */
export declare function pythonReceiverBinding(functionScope: Scope): TypeRef | null;
