import type { BindingRef } from '../../../../_shared/index.js';
/**
 * C merge bindings: simple first-wins by tier (local > import > wildcard).
 * C has no namespaces or reexports, but the tiers are defined for
 * compatibility with the shared infrastructure.
 */
export declare function cMergeBindings(existing: readonly BindingRef[], incoming: readonly BindingRef[], _scopeId: string): BindingRef[];
