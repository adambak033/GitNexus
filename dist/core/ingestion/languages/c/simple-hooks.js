/**
 * C binding scope: always use default auto-hoist (null).
 * C has no self/receiver bindings that need special scoping.
 */
export function cBindingScopeFor(_decl, _innermost, _tree) {
    return null;
}
/**
 * C import owning scope: always use default (null).
 */
export function cImportOwningScope(_imp, _innermost, _tree) {
    return null;
}
/**
 * C receiver binding: always null. C has no methods or receivers.
 */
export function cReceiverBinding(_functionScope) {
    return null;
}
