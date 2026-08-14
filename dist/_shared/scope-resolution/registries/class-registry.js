/**
 * `ClassRegistry` — scope-aware lookup for class-like symbols
 * (RFC §4.4; Ring 2 SHARED #917).
 *
 * Thin wrapper over `lookupCore`, specialized for class kinds:
 *
 *   - `acceptedKinds` = Class / Interface / Enum / Struct / Union /
 *     Trait / TypeAlias / Typedef / Record / Delegate / Annotation /
 *     Template / Namespace.
 *   - `useReceiverTypeBinding` is **false** — classes are resolved by
 *     name through the lexical chain + global qualified fallback, not
 *     via a receiver type.
 *   - Arity filter is not applicable (classes are not called with
 *     argument counts at lookup time).
 */
import { lookupCore } from './lookup-core.js';
import { CLASS_KINDS } from './context.js';
export function buildClassRegistry(ctx) {
    const params = {
        acceptedKinds: CLASS_KINDS,
        useReceiverTypeBinding: false,
        ownerScopedContributor: null,
    };
    return {
        lookup(name, scope) {
            return lookupCore(name, scope, params, ctx);
        },
    };
}
//# sourceMappingURL=class-registry.js.map