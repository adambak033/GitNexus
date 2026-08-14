/**
 * C# CfgVisitor (#2195 U3, plan KTD2).
 *
 * Walks a C# function's tree-sitter AST and drives the language-agnostic
 * {@link CfgBuilder} to produce a serializable {@link FunctionCfg}, plus a
 * def/use harvest ({@link CsharpHarvester}) for the reaching-defs / CDG solvers.
 * Structured like the TS visitor — a `visit_<node_type>` dispatch over the
 * statement taxonomy, driving a per-function {@link ControlFlowContext} — because
 * C# shares TS's `finally` semantics (try/finally AND `using`/`lock`-as-finally),
 * which the finalizer-frame machinery in `control-flow-context.ts` models.
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-c-sharp via the introspection probe before use (mandatory pre-step,
 * KTD5). Known C# surprises pre-empted: records are `record_declaration` (NOT
 * `record_struct_declaration`); there is no `else_clause` wrapper (an
 * `if_statement`'s `alternative` is the else body / nested `if` directly); switch
 * cases live in `switch_section`s under a `switch_body`; `variable_declarator`
 * exposes only a `name` field (the initializer is a positional child);
 * `finally_clause` / `lock_statement` / `catch_filter_clause` expose no field for
 * their body/condition (positional children).
 *
 * Function nodes: `method_declaration`, `local_function_statement`,
 * `constructor_declaration`, `lambda_expression`, `anonymous_method_expression`,
 * and expression-bodied members (`body` is an `arrow_expression_clause`).
 *
 * Edge-kind contract (matches the TS visitor — RD/CDG consume these):
 *  - if/else → `cond-true` / `cond-false`
 *  - loops (for / foreach / while / do-while) → `cond-true` / `loop-back` /
 *    `cond-false`
 *  - switch (`switch_statement`) → `switch-case` / `fallthrough`; a
 *    `switch_expression` arm dispatches as `switch-case` (each arm a guarded
 *    branch, no fallthrough)
 *  - try/catch → `throw` (every protected-region block → the handler); a jump
 *    crossing a `finally` → `finally-return` / `finally-break` / `finally-continue`
 *  - `using` / `lock` → modeled like try/finally: the dispose (`using`) runs on
 *    BOTH normal and exception exit (deterministic), so a `return`/`break`/
 *    `continue` crossing it gets the `finally-*` completion edge too. `lock`'s
 *    monitor-release is likewise a deterministic finalizer.
 *  - return / throw / break / continue → the matching terminator kind
 *  - straight-line → `seq`
 *
 * Classic hazards, handled explicitly (mirrors the TS visitor):
 *  - loops allocate a dedicated loop-exit block so `break` has a target before
 *    the loop's successor is known; `continue` targets the header/increment.
 *  - `for (;;) {}` / `while (true) {}` still emit the structural `header →
 *    loopExit` `cond-false` escape edge so EXIT stays reverse-reachable from
 *    every block — the post-dominator / CDG pass silently emits zero CDG for the
 *    function otherwise.
 *  - labeled `goto`: labels resolve within the function (forward AND backward);
 *    an unresolved `goto` (incl. `goto case`/`goto default`, which target a
 *    switch arm this CFG does not label) routes to EXIT and logs, preserving
 *    single-exit.
 *  - try/catch: conservative exceptional flow — EVERY block in the protected
 *    region edges to the handler (an exception may fire mid-block), matching the
 *    TS `visitTry` over-approximation.
 *
 * Known limitations:
 *  - `yield return` / `yield break`: C# iterator methods compile to a hidden
 *    state machine; tree-sitter shows only the surface `yield_statement`. This
 *    visitor models `yield break` as a terminator → EXIT (`return`) and
 *    `yield return e` as a block whose value continues to the next statement
 *    (the producer resumes after the consumer pulls). The real suspend/resume
 *    state-machine control flow is NOT modeled — documented gap, not faked.
 *  - `goto case L;` / `goto default;` have no statically-labeled CFG target
 *    (switch arms are not labeled blocks here) and route to EXIT like an
 *    unresolved label.
 *  - Async/await suspension points are modeled as straight-line (the awaited
 *    continuation is not a separate flow), consistent with the TS visitor.
 *  - A value-position `switch_expression` (`k switch {…}`) with ≥2 arms IS modeled
 *    as a `switch-case` dispatch in three carriers (#2207): a single-declarator
 *    `var x = k switch {…}` (arms rejoin at a binding continuation), `return k
 *    switch {…}`, and an `=> k switch {…}` expression body (each arm returns).
 *    A value switch in any OTHER position — an assignment RHS (`x = k switch …`),
 *    a call argument, or a multi-declarator decl — stays INLINE (one block).
 *  - Def/use harvest scope: see `csharp-harvest.ts` — member/element writes are
 *    not scalar defs; nested-function bodies are opaque in both directions.
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** C# node types that own a CFG-bearing function body. */
declare const CSHARP_FUNCTION_TYPES: Set<string>;
/** The C# CFG visitor. */
export declare function createCsharpCfgVisitor(): CfgVisitor<SyntaxNode>;
export { CSHARP_FUNCTION_TYPES };
