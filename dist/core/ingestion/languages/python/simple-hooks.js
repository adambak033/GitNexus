/**
 * Trivial / no-op-ish hooks for the Python provider. Kept together
 * because each is a few lines and they share a common theme: they exist
 * to make the provider's choice explicit (rather than relying on
 * "absence == default") so reviewers don't have to re-derive the
 * analysis.
 */
import { findAncestorBeforeBoundary, FUNCTION_NODE_TYPES } from '../../utils/ast-helpers.js';
import { walkToScope } from '../../utils/scope-tree-walk.js';
const PYTHON_METHOD_CONTAINER_TYPES = new Set(['class_definition']);
export function pythonFunctionDefinitionLabel(functionNode, defaultLabel) {
    if (defaultLabel !== 'Function')
        return defaultLabel;
    const ancestor = findAncestorBeforeBoundary(functionNode, PYTHON_METHOD_CONTAINER_TYPES, FUNCTION_NODE_TYPES);
    return ancestor === null ? 'Function' : 'Method';
}
// ─── bindingScopeFor ──────────────────────────────────────────────────────
/** Python has no block scope, so the central extractor's "innermost
 *  enclosing scope" default is already correct for ordinary bindings.
 *  Constructor-injected instance fields are the exception: their marker is
 *  anchored inside `__init__`, but compound receiver resolution needs the
 *  field type on the enclosing Class scope. */
export function pythonBindingScopeFor(decl, innermost, tree) {
    if (decl['@type-binding.instance-field'] !== undefined) {
        return walkToScope(innermost, tree, 'Class');
    }
    return null;
}
// ─── importOwningScope ────────────────────────────────────────────────────
/** Function-local `from x import Y` should attach the binding to the
 *  function scope, not the module. Class-body imports (rare but legal —
 *  `class A: import x` makes `x` a class attribute) attach to the class.
 *  Module-level imports delegate to the central default. */
export function pythonImportOwningScope(_imp, innermost, _tree) {
    if (innermost.kind === 'Function' || innermost.kind === 'Class')
        return innermost.id;
    return null;
}
// ─── receiverBinding ──────────────────────────────────────────────────────
/** Look up `self` or `cls` in the function scope's type bindings.
 *  Returns `null` for free functions (no `self`/`cls`) and for
 *  non-Function scopes. */
export function pythonReceiverBinding(functionScope) {
    if (functionScope.kind !== 'Function')
        return null;
    return functionScope.typeBindings.get('self') ?? functionScope.typeBindings.get('cls') ?? null;
}
