import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
export declare function rustBindingScopeFor(decl: CaptureMatch, innermost: Scope, _tree: ScopeTree): ScopeId | null;
/**
 * Rust `use` statements inside a function body should attach at function scope,
 * not module scope. If the innermost scope is a Function, attach there.
 */
export declare function rustImportOwningScope(_imp: ParsedImport, innermost: Scope, _tree: ScopeTree): ScopeId | null;
export declare function rustReceiverBinding(functionScope: Scope): TypeRef | null;
