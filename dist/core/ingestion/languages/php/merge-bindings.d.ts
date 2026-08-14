/**
 * PHP shadowing precedence for the `mergeBindings` hook.
 *
 * Tier ranking (lower wins in shadowing):
 *
 *   - 0: `local` — a class member, method, local variable, or parameter
 *        declared in this scope.
 *   - 1: `import` / `namespace` / `reexport` — `use Foo\Bar;`,
 *        `use Foo\Bar as Baz;`, `use function`, `use const`.
 *        All use-statement flavors that introduce a name sit at this tier.
 *   - 2: `wildcard` — grouped uses / wildcard imports (deferred; mapped
 *        here for completeness).
 *
 * Within a surviving tier we de-dup by `DefId`, last-write-wins so a
 * `use` re-declared further down the file cleanly replaces the earlier
 * binding.
 */
import type { BindingRef } from '../../../../_shared/index.js';
export declare function phpMergeBindings(bindings: readonly BindingRef[]): readonly BindingRef[];
