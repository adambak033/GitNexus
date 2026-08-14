/**
 * Synthesize `@type-binding.self` captures for Swift instance methods —
 * one for `self` (always on non-static methods inside a type body) and
 * optionally one for `super` (only on class methods when the enclosing
 * class declares a superclass).
 *
 * Mirrors `languages/csharp/receiver-binding.ts`. tree-sitter can't
 * express "the implicit receiver of a non-static member of a
 * class/struct/extension/protocol" via a static `.scm` pattern because
 * the receiver isn't a parameter — it's implicit. Synthesis in code is
 * the same approach C#/Python use for `this`/`self`.
 *
 * Swift AST facts (tree-sitter-swift 0.7.1, verified):
 *   - class / struct / extension all parse to `class_declaration`. For
 *     class/struct the `name:` field is `(type_identifier)`; for an
 *     extension it is `(user_type (type_identifier))` wrapping the
 *     EXTENDED type — so `self` in an extension binds to the extended
 *     type, which is exactly what we want for method dispatch.
 *   - `protocol_declaration` has a `(type_identifier)` name.
 *   - the method body is the `body:` field (`function_body`); a bodyless
 *     `protocol_function_declaration` has no function scope to anchor to.
 *   - a superclass / conformance is an `(inheritance_specifier
 *     inherits_from: (user_type (type_identifier)))` child of the
 *     class_declaration.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/** Walk up to the enclosing type declaration (class/struct/extension/
 *  protocol). Nested local functions still see `self` from the enclosing
 *  type, so don't stop at function-like nodes.
 *
 *  Exported so `swiftEnclosingTypeName` (captures.ts) asks the same question
 *  the same way — the two must agree on what "the enclosing type" is or a
 *  method's owner qualifier and its `self` binding name different types. */
export declare function findEnclosingTypeDeclaration(node: SyntaxNode): SyntaxNode | null;
/**
 * Build zero, one, or two `@type-binding.self` matches for `fnNode`:
 *  - `null`/`[]` if the function is free (no enclosing type), static, or
 *    the enclosing type has no resolvable name, or the function is
 *    bodyless (no scope to anchor to).
 *  - one match (`self`) for instance methods of a class/struct/extension/
 *    protocol.
 *  - two matches (`self` + `super`) only when the function lives in a
 *    `class` (keyword) declaration with a declared superclass.
 *
 * Caller must guarantee `FUNCTION_NODE_TYPES.has(fnNode.type)`.
 */
export declare function synthesizeSwiftReceiverBinding(fnNode: SyntaxNode): CaptureMatch[];
