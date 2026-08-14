// gitnexus/src/core/ingestion/utils/ruby-self-call.ts
/** Maximum parent-walk depth to prevent runaway traversal. */
const MAX_PARENT_DEPTH = 50;
/**
 * Returns true if `callNode` is inside a `singleton_method` or `singleton_class`.
 * Stops at `class`/`module` boundary or MAX_PARENT_DEPTH (50) to bound traversal.
 */
function isInsideSingletonMethod(callNode) {
    let current = callNode.parent;
    let depth = 0;
    while (current && depth++ < MAX_PARENT_DEPTH) {
        if (current.type === 'singleton_method')
            return true;
        if (current.type === 'singleton_class')
            return true;
        if (current.type === 'class' || current.type === 'module')
            return false;
        current = current.parent;
    }
    return false;
}
/**
 * Pure decision function: should a bare Ruby call be rewritten as `self.method`?
 *
 * Returns a `SelfCallRewrite` when all gates pass; null otherwise.
 * Gates (all required): `callForm` is `'free'` or `undefined`, strategy is
 * `'ruby-mixin'`, `enclosingClassName` is non-null, name is not `'super'`,
 * name is not a built-in.
 *
 * Note: Ruby body-statement identifiers produce `callForm === undefined` because
 * the @call node IS the @call.name node in tree-sitter-ruby.
 *
 * Example: `calledName='serialize'` in `Account` instance method →
 * `{callForm:'member', receiverName:'self', receiverTypeName:'Account', dispatchKind:'instance'}`
 */
export function maybeRewriteRubyBareCallToSelf(calledName, callForm, callNode, enclosingClassName, provider) {
    // Body-statement bare identifiers produce `callForm === undefined` because
    // the @call node IS the @call.name node in tree-sitter-ruby. Treat both
    // undefined and 'free' as qualifying.
    if (callForm !== 'free' && callForm !== undefined)
        return null;
    if (provider.mroStrategy !== 'ruby-mixin')
        return null;
    if (!enclosingClassName)
        return null;
    if (calledName === 'super')
        return null;
    if (provider.isBuiltInName(calledName))
        return null;
    const dispatchKind = isInsideSingletonMethod(callNode)
        ? 'singleton'
        : 'instance';
    return {
        callForm: 'member',
        receiverName: 'self',
        receiverTypeName: enclosingClassName,
        dispatchKind,
    };
}
