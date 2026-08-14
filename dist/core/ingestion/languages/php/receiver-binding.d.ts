/**
 * Synthesize `@type-binding.self` captures for PHP instance methods —
 * one for `$this` (always on non-static methods inside a type
 * declaration) and optionally one for `parent` (only on class methods
 * when the enclosing class has an explicit `base_clause`).
 *
 * Mirrors `languages/csharp/receiver-binding.ts` in structure. PHP's
 * grammar doesn't give us a clean `.scm` pattern for "implicit receiver
 * on every instance method inside an enclosing type" because `$this` is
 * not a parameter — it's an implicit receiver. Synthesis in code is the
 * same approach C# uses for `this` / `base`.
 *
 * ## Known limitations
 *
 *   - **Trait `$this`**: for methods defined in a trait, `$this` is
 *     synthesized as a binding to the trait itself. The actual using-class
 *     type is not known at single-file parse time. V1 limitation —
 *     documented in `index.ts`.
 *   - **Anonymous classes**: skipped (no stable enclosing class name).
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Build zero, one, or two `@type-binding.self` matches for `fnNode`:
 *
 *  - Returns `[]` if the function is free (no enclosing type), static,
 *    or the enclosing type has no resolvable name.
 *  - Returns one match (`$this`) for non-static methods inside a
 *    class / trait / interface / enum body.
 *  - Returns two matches (`$this` + `parent`) only when the function
 *    lives in a `class_declaration` that has an explicit `base_clause`.
 *
 * The caller is responsible for guaranteeing
 * `FUNCTION_NODE_TYPES.has(fnNode.type)`.
 */
export declare function synthesizePhpReceiverBinding(fnNode: SyntaxNode): CaptureMatch[];
