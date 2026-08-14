/**
 * Tree-sitter query for Java scope captures (RFC §5.1).
 *
 * Captures the structural skeleton the generic scope-resolution
 * pipeline consumes: scopes (module/class/function), declarations
 * (class-likes, method-likes, fields, variables), imports (import
 * declarations), type bindings (parameter annotations, variable
 * annotations, constructor inference), and references (call sites,
 * member writes/reads).
 *
 * Java specifics that shape this query:
 *
 *   - Java uses `program` as the root node (not `compilation_unit`).
 *   - `import_declaration` nodes carry `scoped_identifier` children
 *     and optional `asterisk` for wildcard imports.
 *   - `static` imports are detected by an anonymous `static` token
 *     child within `import_declaration`.
 *   - `var` (Java 10+ local variable type inference) parses as a
 *     `type_identifier` with text `"var"`, not a dedicated node type.
 *   - Modifiers (`public`, `static`, etc.) are grouped under a
 *     `modifiers` named child with anonymous keyword tokens.
 *   - Superclass inheritance uses a `superclass:` field containing
 *     a `superclass` node wrapping a `type_identifier`.
 *
 * Exposes lazy `Parser` and `Query` singletons so callers don't pay
 * tree-sitter init cost per file.
 */
import Parser from 'tree-sitter';
export declare function getJavaParser(): Parser;
export declare function getJavaScopeQuery(): Parser.Query;
