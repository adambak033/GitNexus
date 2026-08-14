/**
 * Tree-sitter query for JavaScript scope captures (RFC §5.1, Ring 3).
 *
 * Subset of the TypeScript scope query (`languages/typescript/query.ts`)
 * compiled against `tree-sitter-javascript`. TypeScript-only node types
 * (`interface_declaration`, `type_alias_declaration`, `enum_declaration`,
 * `internal_module`, `abstract_class_declaration`, `function_signature`,
 * `method_signature`, `abstract_method_signature`, `type_annotation`,
 * `public_field_definition`) are dropped because:
 *
 *   1. The JS grammar doesn't define them — the query compiler would
 *      throw `InvalidNodeType` if they were included.
 *   2. JavaScript has no static type annotations, so the `@type-binding.*`
 *      patterns derived from TS annotation nodes don't apply.
 *
 * What IS shared with the TypeScript query:
 *
 *   - Scope patterns: `program`, `class_declaration`, `(class)` (the JS
 *     grammar node for class expressions — NOT `class_expression`, which
 *     does not exist in `tree-sitter-javascript`), `function_declaration`,
 *     `generator_function_declaration`, `function_expression`,
 *     `arrow_function`, `method_definition`.
 *   - Declaration patterns for functions, classes, const/let/var,
 *     object-property arrows (Zustand, TanStack, etc.), and HOC-wrapped
 *     variable declarations (forwardRef / memo / useCallback / useMemo).
 *   - Import patterns: `import_statement`, `export_statement` re-exports,
 *     and dynamic `import()` (represented as `call_expression(import)` in
 *     both grammars — the `import` leaf node exists in tree-sitter-javascript
 *     as well as tree-sitter-typescript).
 *   - Type-binding patterns that work without static annotations:
 *     constructor inference (`new User()`), call-result alias
 *     (`const u = getUser()`), member-access alias (`const a = u.addr`),
 *     identifier alias, assignment rebind, and for-of element bindings.
 *     JSDoc-derived type bindings (`@param {User} u`, `@returns {User}`)
 *     are handled separately in `captures.ts` via comment-node scanning.
 *   - Reference patterns: free calls, member calls, constructor calls,
 *     write-access, read-access, and dynamic import.
 *
 * CJS `require()` is NOT captured here; it is handled in `captures.ts`
 * by scanning parent context (destructured vs. namespace) of `call_expression`
 * nodes whose callee is the identifier `require`.
 *
 * Grammar version: `tree-sitter-javascript` pinned in gitnexus/package.json.
 *
 * Exposes lazy `Parser` and `Query` singletons so callers don't pay
 * tree-sitter init cost per file.
 */
import Parser from 'tree-sitter';
export declare const JAVASCRIPT_SCOPE_QUERY: string;
export declare function getJsParser(filePath?: string): Parser;
export declare function getJsScopeQuery(filePath?: string): Parser.Query;
/** Validate that a cached Tree was produced by the JS grammar. */
export declare function jsCachedTreeMatchesGrammar(tree: unknown): boolean;
