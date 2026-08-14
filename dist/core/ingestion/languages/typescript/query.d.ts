/**
 * Tree-sitter query for TypeScript scope captures (RFC §5.1).
 *
 * Captures the structural skeleton the generic scope-resolution pipeline
 * consumes: scopes (module/namespace/class/function), declarations (class-
 * likes, method-likes, properties, variables), imports (one anchor per
 * statement — decomposed in `import-decomposer.ts`), type bindings
 * (parameter annotations, variable annotations, constructor inference,
 * return types), and references (call sites, member writes).
 *
 * TypeScript specifics that shape this query:
 *
 *   - **Namespaces** (`namespace Foo { }`) use `internal_module` with a
 *     `namespace` anon keyword + `identifier` or `nested_identifier` name +
 *     `statement_block` body. Verified via Unit 1 probe.
 *   - **`this` / `super`** are NAMED nodes `(this)` / `(super)` — unlike
 *     C#'s `this`/`base` which are anonymous tokens. `(_)` wildcard matches
 *     them as the receiver child of `member_expression`, so we don't need
 *     explicit string patterns.
 *   - **Optional chaining** (`obj?.m()`) still matches the regular
 *     `member_expression > object: (_) / property: (property_identifier)`
 *     pattern; the `(optional_chain)` child sits between them but doesn't
 *     occupy a named field. Same query handles both.
 *   - **Dynamic imports** (`import('./mod')`) are `call_expression` whose
 *     `function` field is a named `import` node (not a regular identifier).
 *     Captured via a dedicated pattern.
 *   - **Function overloads** — `function f(x:string); function f(x:number);
 *     function f(x) { … }` emits two `function_signature` nodes plus one
 *     `function_declaration`. All three emit `@declaration.function`;
 *     arity metadata synthesis merges parameterTypes.
 *   - **Parameter properties** (`constructor(public name: string)`) — each
 *     parameter emits `@declaration.property` on the enclosing class; the
 *     same identifier also binds as a parameter in the constructor scope
 *     via the normal `required_parameter` → `@type-binding.parameter` path.
 *   - **Enum** — dual type+value. Emits `@scope.class` (enum body contains
 *     member declarations) + `@declaration.enum`. Enum member names
 *     are captured via `enum_assignment` (see below).
 *
 * Node types pinned via `scripts/_probe_typescript_grammar.ts`:
 *   internal_module, namespace_export, namespace_import, import_specifier,
 *   export_specifier, enum_declaration, type_alias_declaration,
 *   abstract_class_declaration, abstract_method_signature, method_signature,
 *   generator_function_declaration, optional_parameter, rest_parameter,
 *   required_parameter, public_field_definition, private_property_identifier,
 *   new_expression (constructor field), call_expression with (import) fn.
 *
 * Grammar version: tree-sitter-typescript pinned in gitnexus/package.json.
 *
 * Exposes lazy `Parser` and `Query` singletons so callers don't pay tree-
 * sitter init cost per file.
 */
import Parser from 'tree-sitter';
export declare const TYPESCRIPT_SCOPE_QUERY: string;
/**
 * Return the right tree-sitter parser for `filePath` (or the TS parser
 * when no path is given — the legacy callsite shape).
 */
export declare function getTsParser(filePath?: string): Parser;
/**
 * Return the right tree-sitter Query (compiled against the same grammar
 * as the parser). A Query bound to the `typescript` grammar can NOT be
 * executed against a Tree produced by the `tsx` grammar — tree-sitter
 * matches by node-type id, and the two grammars have separate id
 * spaces.
 *
 * The TSX query is compiled with the JSX-as-call patterns appended.
 * Those patterns reference `jsx_self_closing_element` /
 * `jsx_opening_element` which exist only in the TSX grammar — embedding
 * them in the plain TS query would throw `Query.InvalidNodeType` at
 * compile time (and even if it didn't, the patterns would never fire on
 * `.ts` source).
 */
export declare function getTsScopeQuery(filePath?: string): Parser.Query;
/**
 * Validate that a cached `Tree` was produced by the grammar matching
 * `filePath` (TSX vs TypeScript). The runtime tree-sitter `Tree` exposes
 * `getLanguage()` (returning the grammar object the parser was bound
 * to); the .d.ts is incomplete, so we reach via a cast. Identity
 * comparison against `TSX_GRAMMAR` / `TS_GRAMMAR` is exact: the same
 * module instance produces both. If `getLanguage` is unavailable for
 * any reason, return true to keep behavior backwards-compatible (the
 * original code never validated grammar at all).
 */
export declare function tsCachedTreeMatchesGrammar(tree: unknown, filePath: string): boolean;
