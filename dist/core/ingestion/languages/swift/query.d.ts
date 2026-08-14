/**
 * Tree-sitter query for Swift scope captures (RFC §5.1).
 *
 * Captures the structural skeleton the generic scope-resolution
 * pipeline consumes: scopes (module/class/function), declarations
 * (class-likes, methods, init, properties), imports, type bindings
 * (parameter annotations, property/field annotations, constructor
 * inference, receiver self), and references (call sites, member calls).
 *
 * Swift specifics that shape this query (all verified against
 * tree-sitter-swift 0.7.1 live s-expressions):
 *
 *   - `class`, `struct`, AND `extension` all parse to a single node
 *     type `class_declaration`. They are distinguished by the `name:`
 *     field node type: class/struct name is a bare `(type_identifier)`,
 *     while an extension's name field wraps the extended type in a
 *     `(user_type (type_identifier))`. The capture below grabs all
 *     three under `@scope.class` + `@declaration.class`; the captures
 *     orchestrator (`captures.ts`) re-tags extensions via the
 *     user_type discriminator so extension members hoist onto the
 *     extended type.
 *   - `protocol_declaration` is its own node; its bodyless method
 *     requirements are `protocol_function_declaration` (NOT
 *     `function_declaration`).
 *   - `init_declaration` has no `name:` field — identity is the `init`
 *     keyword. The captures layer synthesizes its `@declaration.name`.
 *   - Inside a `parameter`, BOTH the label and the type use the field
 *     name `name:` — disambiguate by child node type (simple_identifier
 *     = label, user_type = type). Parameter type bindings are therefore
 *     synthesized in `captures.ts`, not matched here.
 *   - A labeled call argument wraps its label in a dedicated
 *     `value_argument_label` node.
 *   - `self` is its own node `self_expression`; a `self.member()` call
 *     is `call_expression > navigation_expression(target: self_expression,
 *     suffix: navigation_suffix > simple_identifier)`.
 *   - `import_declaration` carries the module path as an `(identifier
 *     (simple_identifier)+)` — one `simple_identifier` per dotted
 *     segment. `@testable` and other attributes surface as a leading
 *     `(modifiers (attribute (user_type (type_identifier))))`.
 *
 * Exposes lazy `Parser` and `Query` singletons so callers don't pay
 * tree-sitter init cost per file.
 */
import Parser from 'tree-sitter';
export declare function getSwiftParser(): Parser;
export declare function getSwiftScopeQuery(): Parser.Query;
