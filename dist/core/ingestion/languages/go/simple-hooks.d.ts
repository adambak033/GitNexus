import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
export declare function goBindingScopeFor(decl: CaptureMatch, innermost: Scope, _tree: ScopeTree): ScopeId | null;
export declare function goImportOwningScope(_imp: ParsedImport, _innermost: Scope, _tree: ScopeTree): ScopeId | null;
export declare function goReceiverBinding(functionScope: Scope): TypeRef | null;
