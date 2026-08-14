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
import type { Callsite, Resolution, ScopeId } from '../types.js';
import type { OwnerScopedContributor, RegistryContext } from './context.js';
/**
 * Extra per-call parameters that vary across call sites but NOT across
 * registries. Kept as a separate shape so `MethodRegistry.lookup` stays
 * concise while still exposing the explicit-receiver + owner-contributor +
 * arity knobs the RFC algorithm needs.
 */
export interface MethodLookupOptions {
    /** Call-site arity for `provider.arityCompatibility`. */
    readonly callsite?: Callsite;
    /** Explicit receiver (e.g., `user` in `user.save()`). See §4.1. */
    readonly explicitReceiver?: {
        readonly name: string;
    };
    /** Optional per-owner contributor (Step 3). */
    readonly ownerScopedContributor?: OwnerScopedContributor;
}
export interface MethodRegistry {
    lookup(name: string, scope: ScopeId, options?: MethodLookupOptions): readonly Resolution[];
}
export declare function buildMethodRegistry(ctx: RegistryContext): MethodRegistry;
//# sourceMappingURL=method-registry.d.ts.map