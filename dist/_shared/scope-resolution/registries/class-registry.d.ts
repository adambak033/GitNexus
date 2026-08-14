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
import type { Resolution, ScopeId } from '../types.js';
import { type RegistryContext } from './context.js';
export interface ClassRegistry {
    /**
     * Look up a class-like symbol by simple or dotted name anchored at
     * `scope`. Returns a confidence-ranked `Resolution[]`; consume `[0]`
     * for the best answer.
     */
    lookup(name: string, scope: ScopeId): readonly Resolution[];
}
export declare function buildClassRegistry(ctx: RegistryContext): ClassRegistry;
//# sourceMappingURL=class-registry.d.ts.map