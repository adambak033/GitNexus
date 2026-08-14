/**
 * Python LEGB precedence merge for the `mergeBindings` hook.
 *
 * Tier ranking (lower wins in shadowing):
 *
 *   - 0: `local` — an `x = …` or `def x` or `class x` in this scope
 *   - 1: `import` / `namespace` / `reexport` — `from m import x`,
 *        `import m`, public re-exports
 *   - 2: `wildcard` — `from m import *`
 *
 * Within a surviving tier we de-dup by `DefId`, last-write-wins (Python
 * semantics: a later assignment replaces an earlier one for lookup
 * purposes).
 */
import type { BindingRef } from '../../../../_shared/index.js';
export declare function pythonMergeBindings(bindings: readonly BindingRef[]): readonly BindingRef[];
