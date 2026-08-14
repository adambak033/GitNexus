import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
/**
 * C binding scope: always use default auto-hoist (null).
 * C has no self/receiver bindings that need special scoping.
 */
export declare function cBindingScopeFor(_decl: CaptureMatch, _innermost: Scope, _tree: ScopeTree): ScopeId | null;
/**
 * C import owning scope: always use default (null).
 */
export declare function cImportOwningScope(_imp: ParsedImport, _innermost: Scope, _tree: ScopeTree): ScopeId | null;
/**
 * C receiver binding: always null. C has no methods or receivers.
 */
export declare function cReceiverBinding(_functionScope: Scope): TypeRef | null;
