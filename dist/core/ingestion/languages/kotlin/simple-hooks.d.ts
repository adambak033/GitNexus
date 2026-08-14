import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
export declare function kotlinBindingScopeFor(decl: CaptureMatch, innermost: Scope, tree: ScopeTree): ScopeId | null;
export declare function kotlinImportOwningScope(_imp: ParsedImport, _innermost: Scope, _tree: ScopeTree): ScopeId | null;
export declare function kotlinReceiverBinding(functionScope: Scope): TypeRef | null;
