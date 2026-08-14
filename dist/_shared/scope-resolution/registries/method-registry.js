/**
 * `MethodRegistry` — scope-aware lookup for method / function / constructor
 * dispatch (RFC §4.4; Ring 2 SHARED #917).
 *
 * Thin wrapper over `lookupCore`, specialized for callable kinds:
 *
 *   - `acceptedKinds` = Method / Function / Constructor.
 *   - `useReceiverTypeBinding` is **true** — the type-binding + MRO walk
 *     (Step 2) is the primary evidence path for receiver-dispatched calls.
 *   - `callsite.arity` flows through to `provider.arityCompatibility`
 *     when provided. When the provider is absent, arity evidence is
 *     `unknown` (neutral signal).
 */
import { lookupCore } from './lookup-core.js';
import { METHOD_KINDS } from './context.js';
export function buildMethodRegistry(ctx) {
    return {
        lookup(name, scope, options = {}) {
            const params = {
                acceptedKinds: METHOD_KINDS,
                useReceiverTypeBinding: true,
                ownerScopedContributor: options.ownerScopedContributor ?? null,
                ...(options.callsite !== undefined ? { callsite: options.callsite } : {}),
                ...(options.explicitReceiver !== undefined
                    ? { explicitReceiver: options.explicitReceiver }
                    : {}),
            };
            return lookupCore(name, scope, params, ctx);
        },
    };
}
//# sourceMappingURL=method-registry.js.map