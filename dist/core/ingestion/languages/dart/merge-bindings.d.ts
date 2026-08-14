/**
 * Shadowing precedence for the Dart `mergeBindings` hook. Three tiers:
 * 0 local, 1 import/namespace/reexport, 2 wildcard. Keeps only the best
 * (lowest) tier present, then de-dups survivors by `def.nodeId`
 * (last-write-wins). Mirror of `languages/swift/merge-bindings.ts` — Dart
 * imports bring a whole library namespace into scope (wildcard-leaf), so
 * local declarations always shadow imported names.
 */
import type { BindingRef } from '../../../../_shared/index.js';
export declare function dartMergeBindings(bindings: readonly BindingRef[]): readonly BindingRef[];
