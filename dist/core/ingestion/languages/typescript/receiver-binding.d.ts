/**
 * Synthesize `@type-binding.this` captures for TypeScript instance-like
 * methods.
 *
 * Tree-sitter can't cleanly express "the implicit `this` receiver of a
 * non-static member of a class / interface / abstract class" via a
 * static `.scm` pattern, so we walk up the AST in code — mirrors
 * Python's `self` / `cls` and C#'s `this` / `base` synthesis.
 *
 * Scope coverage:
 *
 *   - `method_definition` inside `class_declaration`,
 *     `abstract_class_declaration`, or `class_expression` → synthesize
 *     `this` → enclosing class name.
 *   - `method_signature` / `abstract_method_signature` inside
 *     `interface_declaration` or `abstract_class_declaration` →
 *     synthesize `this` → enclosing type's name (so interface method
 *     bodies' `this.x` chains resolve via the interface's field
 *     annotations).
 *   - `arrow_function` / `function_expression` that is a direct value
 *     of a `public_field_definition` (class field) — `m = () => {}` —
 *     synthesize `this` → enclosing class name. These capture `this`
 *     lexically; without synthesis, their body's `this.foo` wouldn't
 *     resolve.
 *
 * Not synthesized (intentionally):
 *
 *   - `static` methods / static fields. `this` in a static context
 *     refers to the class constructor, not an instance; we leave the
 *     binding empty and let chain resolution fall through to the
 *     class's static members lookup.
 *   - Regular `function_declaration` / `function_expression` at
 *     module level or in a non-class context. No enclosing type, no
 *     `this` semantics.
 *   - Arrow functions nested inside a method body. The scope-chain
 *     walk in `tsReceiverBinding` finds the outer method's `this`
 *     naturally, matching TS's lexical-this rule for arrow functions.
 *
 * Each synthesized match emits the anchor captures needed by
 * `interpretTsTypeBinding`:
 *
 *   `@type-binding.this`  (source discriminator — interpret maps to 'self')
 *   `@type-binding.name`  (the literal `'this'`)
 *   `@type-binding.type`  (the enclosing type's name)
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Produce zero or one `CaptureMatch` synthesizing `this` for `fnNode`.
 *
 *   - `null` — function has no synthetic `this` (free / static /
 *     not-in-class / no name on enclosing type).
 *   - One match — anchor on the function body so the synthetic binding
 *     attaches to the function's scope (not the outer class scope).
 *
 * The caller is responsible for passing a `fnNode` whose type is one
 * of the scope function nodes the scope query emits.
 */
export declare function synthesizeTsReceiverBinding(fnNode: SyntaxNode): CaptureMatch | null;
/**
 * Nodes that REBIND `this`, so the walk for an enclosing type must stop at them.
 *
 * Without these the walk ran to the top of the file and happily synthesized a binding
 * from a type that does not own the member. An object-literal method nested in a class
 * bound `this` to the CLASS:
 *
 *     class A { outer() { const o = { inner() { return this.x; } }; return o; } }
 *
 * `this` inside `o.inner` is `o`, never `A` — so every `this.…` in such a method
 * resolved against the wrong type. Only the module-level object literal escaped, because
 * there was no enclosing class to reach.
 *
 * An arrow is deliberately absent: it inherits `this` lexically, so the walk SHOULD pass
 * through it (that is what makes a class-field arrow `m = () => this.x` resolve).
 */
export declare const THIS_REBINDING_BOUNDARY_TYPES: ReadonlySet<string>;
