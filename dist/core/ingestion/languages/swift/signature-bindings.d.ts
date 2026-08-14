/**
 * Synthesize parameter-type and function return-type `@type-binding.*`
 * captures for a Swift function-like node.
 *
 * Why synthesized rather than queried: Swift's tree-sitter grammar reuses
 * the field name `name:` for the function name, each parameter's label,
 * each parameter's type, AND the function's return type. A tree-sitter
 * query with two `name:` fields cross-assigns those captures and produces
 * garbage bindings (e.g. `save: save`). Reading the node via the existing
 * `swiftMethodConfig.extractParameters` / `extractReturnType` extractors
 * — which already handle the grammar correctly for the legacy parse path
 * — yields the right name→type pairs. This mirrors how receiver and arity
 * metadata are synthesized in `captures.ts` instead of queried.
 *
 *   - **Parameter bindings** anchor inside the function body so the
 *     binding lands in the Function scope: `func f(u: User) { u.save() }`
 *     → `u: User` visible in f's body.
 *   - **Return-type binding** anchors at the function node and carries
 *     `@type-binding.return`, which `swiftBindingScopeFor` hoists to the
 *     Module scope so `propagateImportedReturnTypes` mirrors it across
 *     files and callers see `let u = getUser(); u.save()`.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export declare function synthesizeSwiftSignatureBindings(fnNode: SyntaxNode): CaptureMatch[];
