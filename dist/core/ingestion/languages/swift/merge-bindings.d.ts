/**
 * Swift shadowing precedence for the `mergeBindings` hook.
 *
 * Tier ranking (lower wins in shadowing):
 *
 *   - 0: `local` — a type member, method, local var, or parameter
 *        declared in this scope.
 *   - 1: `import` / `namespace` / `reexport` — names brought in by an
 *        `import ModuleName` (whole-module, including `@testable`).
 *   - 2: `wildcard` — reserved; Swift's whole-module import already
 *        behaves like a namespace tier, so this is rarely populated.
 *
 * Swift resolves an ambiguity between two imported modules by requiring
 * an explicit `Module.Symbol` qualifier; for receiver-typed dispatch we
 * treat all imports as one tier. Locals always shadow imports.
 *
 * Within a surviving tier we de-dup by `DefId`, last-write-wins.
 */
import type { BindingRef } from '../../../../_shared/index.js';
export declare function swiftMergeBindings(bindings: readonly BindingRef[]): readonly BindingRef[];
