/**
 * Synthesize `@type-binding.self` captures for C# instance methods —
 * one for `this` (always on non-static methods inside a type
 * declaration) and optionally one for `base` (only on class methods
 * when the enclosing class has an explicit base in its `base_list`).
 *
 * Mirrors `languages/python/receiver-binding.ts` in structure. The
 * tree-sitter-c-sharp grammar doesn't give us a clean `.scm` pattern
 * for "this-receiver on every instance method inside an enclosing
 * type" because the binding isn't a parameter — it's an implicit
 * receiver. Synthesis in code is the same approach Python uses for
 * `self` / `cls`.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Build zero, one, or two `@type-binding.self` matches for `fnNode`:
 *
 *  - Returns `null` if the function is free (no enclosing type),
 *    static, or the enclosing type has no resolvable name.
 *  - Returns one match (`this`) for non-static methods inside a
 *    class/struct/record/interface.
 *  - Returns two matches (`this` + `base`) only when the function
 *    lives in a `class_declaration` (or `record_declaration`) that has
 *    at least one base entry. Structs cannot inherit classes;
 *    interfaces cannot call `base.X`.
 *
 *  The caller is responsible for guaranteeing
 *  `FUNCTION_NODE_TYPES.has(fnNode.type)`.
 */
export declare function synthesizeCsharpReceiverBinding(fnNode: SyntaxNode): CaptureMatch[];
