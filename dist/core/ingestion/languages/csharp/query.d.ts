/**
 * Tree-sitter query for C# scope captures (RFC §5.1).
 *
 * Captures the structural skeleton the generic scope-resolution
 * pipeline consumes: scopes (module/namespace/class/function),
 * declarations (class-likes, method-likes, properties, variables,
 * local functions), imports (using directives), type bindings
 * (parameter annotations, variable annotations, constructor
 * inference), and references (call sites, member writes).
 *
 * C# specifics that shape this query:
 *
 *   - Both block-scoped (`namespace X { }`) and file-scoped
 *     (`namespace X;`) namespaces. tree-sitter-c-sharp emits them
 *     under distinct node types (`namespace_declaration` vs
 *     `file_scoped_namespace_declaration`); both map to
 *     `@scope.namespace` since the scope semantics are identical.
 *   - `partial class X` splits a Class def across files. Each file
 *     emits its own `@declaration.class`; cross-file resolution is
 *     handled at the graph-bridge layer via the qualified-name key.
 *   - `using X = Y;` aliases and `using static X;` are interpreted in
 *     `interpret.ts` via the `@import.*` captures. All three using
 *     flavors share the same anchor (`@import.statement`).
 *   - Explicit interface implementations (`void IFoo.Bar() { }`)
 *     expose the qualified name via the existing `@declaration.name`
 *     — the extractor's `csharpMethodConfig.extractQualifiedName`
 *     picks up the explicit qualifier from the method declaration
 *     node.
 *
 * Exposes lazy `Parser` and `Query` singletons so callers don't pay
 * tree-sitter init cost per file.
 */
import Parser from 'tree-sitter';
export declare function getCsharpParser(): Parser;
export declare function getCsharpScopeQuery(): Parser.Query;
