/**
 * The Dart scope-capture tree-sitter query (`DART_SCOPE_QUERY`) plus lazy
 * `Parser`/`Query` singletons. Mirror of `languages/swift/query.ts`.
 *
 * Verified against tree-sitter-dart 1.0.0 (UserNobody14, commit 80e23c07,
 * ABI 14) — every node type below also appears in the legacy `DART_QUERIES`,
 * which is validated against the same grammar.
 *
 * NOTE: This query intentionally covers ONLY the constructs that map cleanly
 * to a single node + the suffix-driven scope-extractor vocabulary:
 *   - `@scope.module` / `@scope.class` (type bodies)
 *   - `@declaration.{class,trait,enum,function,method,constructor,property}`
 *   - `@import.source`
 *
 * The hard parts are synthesized in `captures.ts` instead of queried, because
 * Dart's grammar can't express them as a single node:
 *   - Function/method SCOPES — `function_signature` and `function_body` are
 *     SIBLINGS, so the Function scope must span both (range composition).
 *   - Calls / member reads — Dart's postfix `identifier (selector …)` chains
 *     have no `call_expression` node; the receiver is a sibling run.
 *   - Heritage references (`extends`/`implements`/`with`).
 *   - Parameter / return / receiver type bindings and arity metadata.
 */
import Parser from 'tree-sitter';
export declare function getDartParser(): Parser;
export declare function getDartScopeQuery(): Parser.Query;
