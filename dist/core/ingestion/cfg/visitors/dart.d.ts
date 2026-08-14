/**
 * Dart CfgVisitor (#2195) — the VENDORED-GRAMMAR, SPLIT-FUNCTION brace-family
 * CFG target. Dart's tree-sitter grammar is unusual: a function is NOT a single
 * wrapping node — a `function_signature` / `method_signature` / `getter_signature`
 * / `setter_signature` is followed by a SIBLING `function_body` (the body is a
 * sibling of the signature, under `program` / `class_body`, NOT a child of the
 * declaration). This visitor therefore treats the `function_body` itself (and a
 * closure's `function_expression`) as the CFG-bearing node, reaching the params
 * via the body's previous-sibling signature — exactly the seam the existing
 * `dartEnclosingFunctionFinder` uses. Every node type and field literal below was
 * grammar-validated against the vendored tree-sitter-dart via the introspection
 * probe before use (mandatory pre-step — the grammar-literal CI gate maps
 * `dart.ts → Dart` and fails on a wrong literal).
 *
 * The visitor drives the language-agnostic {@link CfgBuilder} to produce a
 * serializable {@link FunctionCfg} plus a def/use harvest ({@link DartHarvester})
 * for the reaching-defs / CDG solvers, structured like the sibling visitors — a
 * `visit_<node_type>` dispatch over the control-flow taxonomy driving a
 * per-function {@link ControlFlowContext} for labeled break/continue and the
 * try/catch/finally completion chain (Dart shares JVM-style `finally` semantics).
 *
 * Dart shapes pre-empted (verified by a real parse):
 *  - `function_body` — `{ block }` OR an arrow body `=> expr ;` (no `block`
 *    wrapper). A `getter_signature` / `setter_signature` body is the same
 *    `function_body` shape.
 *  - `function_expression` (a closure) — fields `parameters:formal_parameter_list`
 *    and `body:function_expression_body` (itself a `{ block }` or `=> expr`).
 *  - `block` — `{ statement* }`; statements are its named children.
 *  - `if_statement` — `if ( COND ) consequence:STMT [ else alternative:STMT ]`.
 *    The condition is the named child between `(` and `)`; the consequence/
 *    alternative are a `block` (braced) or a bare statement (`if (c) a();`). An
 *    `else if` is the nested `if_statement` in the `alternative` field.
 *  - `for_statement` — `for ( for_loop_parts ) body:STMT`. `for_loop_parts` is
 *    C-style (`init:` `condition:` `;` `update:`) OR for-in (`inferred_type`?
 *    `name:identifier` `in` `value:` — or a bare `identifier in value` over an
 *    existing variable).
 *  - `while_statement` — `while condition:parenthesized_expression body:STMT`.
 *  - `do_statement` — BOTTOM-TEST: `do body:STMT while condition:… ;`.
 *  - `switch_statement` — `switch condition:parenthesized_expression
 *    body:switch_block`. A `switch_block` holds `switch_statement_case`
 *    (`case_builtin constant_pattern : STMT*` — an EMPTY case with no statements
 *    falls through to the next; an optional leading `label` names it) and one
 *    `switch_statement_default` (`default : STMT*`). Dart cases do NOT fall
 *    through implicitly EXCEPT an empty case; an explicit `continue LABEL;` jumps
 *    to the labeled case. `switch_expression` (`{ switch_expression_case* }`,
 *    `pat => expr`) never falls through.
 *  - `try_statement` — `try body:block` then `on type? catch_clause? block`
 *    groups (the `on Type` / `catch (e[, st])` parts are bare children:
 *    `on` keyword, `type_identifier`, `catch_clause` → `catch_parameters`, and the
 *    handler `block`) plus an optional `finally_clause` (`finally block`).
 *  - jumps: `return_statement` (`return [expr] ;`), `break_statement`
 *    (`break [label] ;`), `continue_statement` (`continue [label] ;`),
 *    `throw_expression` (in an `expression_statement`), `rethrow_expression`
 *    (`rethrow ;`), `assert_statement` (`assert ( … ) ;` — may throw).
 *  - a labeled LOOP (`outer: for …`) parses as a stray `ERROR [identifier :]`
 *    SIBLING immediately before the `for_statement` (tree-sitter-dart does not
 *    model a statement label outside a switch); the visitor reads that ERROR
 *    sibling as a pending label, so `break outer` still resolves.
 *
 * Edge-kind contract (matches the existing visitors — RD/CDG consume these):
 *  - if / else → `cond-true` / `cond-false`
 *  - `for` / `while` → `cond-true` / `loop-back` / `cond-false`
 *  - `do … while` → bottom-test: body runs first, condition `loop-back` (true)
 *    / `cond-false` (exit)
 *  - `switch` dispatch → `switch-case`; an EMPTY case spills to the next case via
 *    a `fallthrough` edge, and an explicit `continue LABEL;` is a `fallthrough`
 *    to the labeled case. A non-empty case rejoins after the switch (no implicit
 *    fallthrough).
 *  - try/on/catch → `throw` (every protected-region block → the first handler); a
 *    `finally` runs on BOTH normal and exception exit, so a `return`/`break`/
 *    `continue` crossing it threads through (`finally-*` completion edges). A
 *    `rethrow` re-routes to the next-outer handler / EXIT.
 *  - return / throw / break / continue / rethrow → the matching terminator kind;
 *    a labeled `break outer` / `continue outer` targets the labeled loop frame
 *  - straight-line → `seq`
 *
 * Dart-specific modeling decisions (documented approximations):
 *  - `while (true) {}` / `for (;;) {}` may never terminate; like the C-family /
 *    Go / Rust / Swift / Kotlin visitors, this visitor ALWAYS emits the
 *    structural `header → loopExit` `cond-false` escape edge so EXIT stays
 *    reverse-reachable and the post-dominator / CDG pass is not silently skipped
 *    for the function. This is the single highest-risk correctness property.
 *  - try/on/catch: conservative exceptional flow — EVERY block in the protected
 *    region edges to the first handler (an exception may fire mid-block),
 *    matching the Java / C# / Swift over-approximation. A `throw` / `rethrow` /
 *    `assert` with no enclosing handler routes to EXIT (the function propagates
 *    the error to its caller).
 *  - a closure (`function_expression`) is collected as its OWN function by
 *    `isFunction`, so its body gets a standalone CFG; in the ENCLOSING function it
 *    is an opaque straight-line value (its body is not followed inline).
 *  - a value-position `switch_expression` (Dart 3) with ≥2 arms IS modeled as a
 *    `switch-case` dispatch in two carriers (#2207): a single-binding `var x =
 *    switch (v) {…}` (arms rejoin at a binding continuation) and `return switch
 *    (v) {…}` (each arm returns). A `switch_expression` in any OTHER position — a
 *    call argument, a multi-binding decl — stays INLINE (its conditional arm
 *    sub-evaluation is a HARVEST may-def concern, see dart-harvest.ts). `?:` /
 *    `??` / `?.` micro-branches are excluded by design (like the TS treatment).
 *
 * Known limitations:
 *  - block-scope shadowing in the harvest is flattened to one function table (see
 *    dart-harvest.ts) — a documented v1 over-approximation.
 *  - `async` / `await` / `async*` / `sync*`: suspension/yield points are normal
 *    straight-line flow (no scheduler edges). A closure passed to `Future`/stream
 *    APIs gets its own CFG like any closure.
 *  - a generative/redirecting constructor's `: initializer` list and a
 *    `factory` constructor body are NOT modeled as a distinct function node in
 *    this v1 set (the `function_body` after a `constructor_signature` IS modeled;
 *    the initializer list runs straight-line into it — documented gap).
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** Signature node types whose SIBLING `function_body` owns a CFG-bearing body. */
declare const DART_SIGNATURE_TYPES: Set<string>;
/** The Dart CFG visitor. */
export declare function createDartCfgVisitor(): CfgVisitor<SyntaxNode>;
export { DART_SIGNATURE_TYPES };
