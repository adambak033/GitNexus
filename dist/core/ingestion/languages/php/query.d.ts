/**
 * Tree-sitter query for PHP scope captures (RFC #909 Ring 3 LANG-php).
 *
 * Captures the structural skeleton the generic scope-resolution pipeline
 * consumes: scopes (program/namespace/class/function), declarations
 * (class-likes, method-likes, properties, variables), imports
 * (namespace_use_declaration), type bindings (parameter annotations,
 * property types, constructor-inferred locals, return types), and
 * references (call sites, member writes).
 *
 * PHP specifics that shape this query:
 *
 *   - `namespace_use_declaration` is an import only at top level / inside
 *     namespace blocks. Class-body `use_declaration` (trait-use) is a
 *     different node type and is NOT captured here.
 *
 *   - `object_creation_expression` has `name` and `qualified_name` as
 *     direct children (no wrapping node).
 *
 *   - `method_declaration` exposes a `return_type:` named field containing
 *     a `type` node, which may be `named_type`, `optional_type`, etc.
 *
 *   - `property_element` has a `name:` field of type `variable_name`.
 *
 *   - `variable_name` nodes always include the `$` sigil in their text.
 *
 * Exposes lazy `Parser` and `Query` singletons so callers don't pay
 * tree-sitter init cost per file.
 */
import Parser from 'tree-sitter';
export declare function getPhpParser(): Parser;
export declare function getPhpScopeQuery(): Parser.Query;
