/**
 * Java shadowing precedence for the `mergeBindings` hook.
 *
 * Tier ranking (lower wins):
 *   - 0: `local` — class member, method, local variable, parameter
 *   - 1: `import` / `namespace` / `reexport` — explicit imports
 *   - 2: `wildcard` — wildcard imports (`import x.y.*`)
 *
 * Within a surviving tier: de-dup by DefId, last-write-wins.
 */
import type { BindingRef } from '../../../../_shared/index.js';
export declare function javaMergeBindings(bindings: readonly BindingRef[]): readonly BindingRef[];
