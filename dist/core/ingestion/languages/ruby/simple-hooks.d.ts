import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef, NodeLabel } from '../../../../_shared/index.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';
export declare function rubyBindingScopeFor(decl: CaptureMatch, innermost: Scope, tree: ScopeTree): ScopeId | null;
/**
 * Ruby `require` / `include` inside a function or class body should attach
 * at that scope, not module scope.
 */
export declare function rubyImportOwningScope(_imp: ParsedImport, innermost: Scope, _tree: ScopeTree): ScopeId | null;
export declare function rubyReceiverBinding(functionScope: Scope): TypeRef | null;
/**
 * Reclassify top-level `def` as `'Method'` when it appears inside a
 * `class` or `module` body. Stand-alone defs remain `'Function'`.
 */
export declare function rubyFunctionDefinitionLabel(functionNode: SyntaxNode, defaultLabel: NodeLabel): NodeLabel;
