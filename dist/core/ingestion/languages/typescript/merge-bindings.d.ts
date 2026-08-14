/**
 * TypeScript declaration-merging + LEGB precedence for the `mergeBindings`
 * hook.
 *
 * TypeScript has a unique wrinkle that Python / C# don't: **declaration
 * merging**. The same name can legally coexist in several "declaration
 * spaces" simultaneously:
 *
 *   - **value** space — `class X`, `function X`, `const X`, `var X`,
 *     `let X`, `enum X`, `namespace X` (adds runtime object)
 *   - **type**  space — `interface X`, `type X`, `class X`, `enum X`
 *   - **namespace** space — `namespace X`, `class X` (static-accessed
 *     members are reachable via dotted name)
 *
 * Classes and enums are unique in that each declaration occupies both
 * the value AND type spaces. This lets:
 *
 *     class Foo {}
 *     interface Foo { bar: number; }   // merges additional type members
 *     namespace Foo { export const X = 1; } // adds static-like value
 *
 * all coexist for the same name.
 *
 * ## Algorithm
 *
 * For each declaration space independently:
 *   1. Tier bindings by origin (lower wins):
 *        0 — `local`
 *        1 — `import` / `namespace` / `reexport`
 *        2 — `wildcard` (`export * from …`)
 *   2. Keep only bindings at the best (lowest) tier in that space.
 *
 * Then union survivors across spaces and dedupe by `DefId`.
 *
 * ## Shadowing examples
 *
 *   - `class Foo {}` + `function Foo() {}` in same scope → COMPILE ERROR
 *     in TS source, but if both reach us with distinct DefIds we keep
 *     both (value space has two locals at tier 0 — de-dup by nodeId
 *     preserves both). No worse than C#-style merge.
 *   - `class Foo {}` (local, value+type) + `import type { Foo } from './a'`
 *     (tier-1, type-only) → local wins in both type AND value spaces;
 *     the import is not kept.
 *   - `interface Foo {}` (local, type-only) + `import { Foo } from './a'`
 *     (tier-1, value+type) → local wins in type space; import wins in
 *     value space (local doesn't occupy it). Both kept.
 *   - `namespace Foo {}` (local, namespace+value) + `class Foo {}` (local,
 *     value+type) → both at tier 0 in their respective spaces, kept.
 *
 * ## Limitations
 *
 *   - We classify imports by their `def.type` just like locals. Without
 *     a space-annotation on `ParsedImport`, `import type { Foo }` looks
 *     the same as `import { Foo }` at this layer — the parse phase
 *     decomposer marks type-only imports so the extractor CAN annotate
 *     `def.type = 'Type'` downstream if desired. Today it doesn't, so
 *     `import type` imports and value imports fall in the same bucket
 *     per their target def's NodeLabel. Parity with legacy behavior
 *     (which also doesn't track type-only separately) is preserved.
 */
import type { BindingRef } from '../../../../_shared/index.js';
export declare function typescriptMergeBindings(bindings: readonly BindingRef[]): readonly BindingRef[];
