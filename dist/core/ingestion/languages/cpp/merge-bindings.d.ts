import type { BindingRef } from '../../../../_shared/index.js';
/**
 * C++ merge bindings: first-wins by tier.
 *
 * C++ tier precedence:
 *   local(0) > namespace(1) > import(2) > reexport(3) > wildcard(4)
 *
 * Unlike C (no namespaces), C++ uses the `namespace` tier for symbols
 * brought in via `using namespace X;` that are then locally referenced.
 * The tier ordering ensures local definitions shadow namespace imports,
 * which in turn shadow wildcard #include imports.
 */
export declare function cppMergeBindings(existing: readonly BindingRef[], incoming: readonly BindingRef[], _scopeId: string): BindingRef[];
