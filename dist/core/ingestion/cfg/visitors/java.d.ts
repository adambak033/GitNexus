/**
 * Java CfgVisitor (#2195 U4, plan KTD2).
 *
 * Walks a Java method/constructor/lambda's tree-sitter AST and drives the
 * language-agnostic {@link CfgBuilder} to produce a serializable
 * {@link FunctionCfg}, plus a def/use harvest ({@link JavaHarvester}) for the
 * reaching-defs / CDG solvers. Structured like the C# visitor — a
 * `visit_<node_type>` dispatch over the statement taxonomy, driving a
 * per-function {@link ControlFlowContext} — because Java shares C#'s `finally`
 * semantics (try/finally, try-with-resources auto-close = finally, labeled
 * break/continue), which the finalizer-frame + labeled-frame machinery in
 * `control-flow-context.ts` models.
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-java via the introspection probe before use (mandatory pre-step,
 * KTD5). Known Java surprises pre-empted (verified by a real parse):
 *  - Generics are `generic_type` (NOT `parameterized_type`, which this grammar
 *    does not have).
 *  - BOTH the classic colon `switch` and the arrow `switch` parse under
 *    `switch_expression` (there is no `switch_statement` node). Its body is a
 *    `switch_block` (field `body`). A classic group is a
 *    `switch_block_statement_group` (`switch_label` + statements, FALLS THROUGH);
 *    an arrow rule is a `switch_rule` (`switch_label` `->` one body, does NOT
 *    fall through). Case tests live in a `switch_label`.
 *  - Comments are `line_comment` / `block_comment` (NOT `comment`).
 *  - An `if`/`while`/`do`/`synchronized` condition is wrapped in a
 *    `parenthesized_expression`; `consequence`/`alternative`/`body` are
 *    statements directly (no `else_clause` wrapper — an `else if` is the nested
 *    `if_statement` in the `alternative` field).
 *  - `for_statement` uses the `init` field (NOT `initializer`), plus `condition`,
 *    `update`, `body`. `enhanced_for_statement` uses `type`/`name`/`value`/`body`.
 *  - `try_with_resources_statement` carries a `resources` field
 *    (`resource_specification` of `resource` nodes); a plain `try_statement` has
 *    `body` + `catch_clause`s + an optional `finally_clause`.
 *  - `labeled_statement` = a leading `identifier` (the label) then the labeled
 *    statement (no field). `break`/`continue` carry an optional trailing
 *    `identifier` label.
 *
 * Function nodes: `method_declaration`, `constructor_declaration`,
 * `compact_constructor_declaration` (a record's canonical-constructor body), and
 * `lambda_expression`.
 *
 * Edge-kind contract (matches the TS / C# visitors — RD/CDG consume these):
 *  - if/else → `cond-true` / `cond-false`
 *  - loops (for / enhanced-for / while / do-while) → `cond-true` / `loop-back` /
 *    `cond-false`
 *  - switch → `switch-case` / `fallthrough`; a `switch_block_statement_group`
 *    (classic colon form) falls through to the next group when it does not
 *    `break`/`return`/`yield`; a `switch_rule` (arrow form) does NOT fall
 *    through (its single body always rejoins after the switch).
 *  - try/catch → `throw` (every protected-region block → the handler); a
 *    `try_with_resources_statement`'s auto-close runs on BOTH normal and
 *    exception exit (finally semantics), so a `return`/`break`/`continue`
 *    crossing it gets a `finally-*` completion edge too. `synchronized`'s
 *    monitor-release is likewise a deterministic finalizer.
 *  - return / throw / break / continue → the matching terminator kind; a labeled
 *    `break outer;` / `continue outer;` targets the labeled frame, not the
 *    nearest one.
 *  - straight-line → `seq`
 *
 * Classic hazards, handled explicitly (mirrors the C# / TS visitors):
 *  - loops allocate a dedicated loop-exit block so `break` has a target before
 *    the loop's successor is known; `continue` targets the header/increment.
 *  - `for (;;) {}` / `while (true) {}` still emit the structural `header →
 *    loopExit` `cond-false` escape edge so EXIT stays reverse-reachable from
 *    every block — the post-dominator / CDG pass silently emits zero CDG for the
 *    function otherwise.
 *  - labeled `break outer;` / `continue outer;`: the label resolves against the
 *    frame of the construct it names (a labeled loop/switch, or a labeled block),
 *    NOT the nearest enclosing frame. An UNLABELED break never targets a labeled
 *    block frame (control-flow-context.ts enforces this).
 *  - try/catch: conservative exceptional flow — EVERY block in the protected
 *    region edges to the handler (an exception may fire mid-block), matching the
 *    TS `visitTry` over-approximation.
 *
 * Known limitations:
 *  - A value-position `switch` with ≥2 arms is modeled as control flow in the two
 *    highest-value carriers (#2207): a single-declarator `var x = switch (…) {…}`
 *    (arms rejoin at a binding continuation) and `return switch (…) {…}` (each arm
 *    returns). A value-position `switch` in any OTHER position — an assignment RHS
 *    (`x = switch …`), a call argument, or a multi-declarator decl — is still left
 *    INLINE inside its owning block (the value flows to one coalesced block).
 *  - `yield` (in a switch expression) continues to the next statement (it yields
 *    one value to the enclosing switch and the arm ends); the switch-expression
 *    state machine is not modeled, consistent with the inline-value-switch gap.
 *  - Exceptions thrown by a method call mid-statement are over-approximated by
 *    the conservative per-block throw edge inside a `try`; outside any `try` they
 *    are not modeled (no edge), matching TS.
 *  - Def/use harvest scope: see `java-harvest.ts` — field/array writes are not
 *    scalar defs; nested-function (lambda) bodies are opaque in both directions.
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** Java node types that own a CFG-bearing function body. */
declare const JAVA_FUNCTION_TYPES: Set<string>;
/** The Java CFG visitor. */
export declare function createJavaCfgVisitor(): CfgVisitor<SyntaxNode>;
export { JAVA_FUNCTION_TYPES };
