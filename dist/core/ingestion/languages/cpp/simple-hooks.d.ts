import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
/**
 * C++ binding scope: default auto-hoist (null) for most declarations.
 *
 * For `for` statement init-scope variables (e.g. `for (int i = 0; ...)`),
 * the variable is scoped to the for-block, not the enclosing function.
 * The tree-sitter scope query already captures for_statement as @scope.block,
 * so tree-sitter's scope nesting handles this automatically — we return null
 * to let the default auto-hoist apply.
 */
export declare function cppBindingScopeFor(decl: CaptureMatch, innermost: Scope, tree: ScopeTree): ScopeId | null;
/**
 * C++ import owning scope: default (null).
 * #include and using declarations are file-scoped in C++.
 */
export declare function cppImportOwningScope(_imp: ParsedImport, _innermost: Scope, _tree: ScopeTree): ScopeId | null;
/**
 * C++ receiver binding: return `this` TypeRef for methods inside a class.
 *
 * When a function scope is inside a class scope, the implicit `this` pointer
 * refers to the enclosing class. This enables `this->method()` and implicit
 * `this` member access resolution.
 */
export declare function cppReceiverBinding(functionScope: Scope): TypeRef | null;
