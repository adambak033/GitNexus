/**
 * Go CfgVisitor (#2195 U5, plan KTD2) — the highest-divergence C-family target.
 *
 * Walks a Go function / method / closure's tree-sitter AST and drives the
 * language-agnostic {@link CfgBuilder} to produce a serializable
 * {@link FunctionCfg}, plus a def/use harvest ({@link GoHarvester}) for the
 * reaching-defs / CDG solvers. Structured like the Java / C# visitors — a
 * `visit_<node_type>` dispatch over the statement taxonomy, driving a
 * per-function {@link ControlFlowContext} for labeled break/continue and the
 * `defer` completion chain (Go's analogue of finally route-through).
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-go via the introspection probe before use (mandatory pre-step,
 * KTD5). Go shapes pre-empted (verified by a real parse):
 *  - functions: `function_declaration`, `method_declaration` (field `receiver`),
 *    `func_literal` — all carry `parameters` + a `body` `block`.
 *  - `if_statement` fields `initializer`? / `condition` / `consequence` /
 *    `alternative`?; `else if` ⇒ `alternative` is a nested `if_statement`, plain
 *    `else` ⇒ `alternative` is a `block` (NO `else_clause` wrapper).
 *  - `for_statement` — Go's SINGLE loop keyword. `body` is a `block`; the first
 *    child is a `for_clause` (C-style, fields `initializer`?/`condition`?/`update`?)
 *    OR a `range_clause` (for-range, fields `left`?/`right`) OR a bare condition
 *    expression (while-style) OR ABSENT (`for {}` infinite). All four handled.
 *  - `expression_switch_statement` (fields `initializer`?/`value`?; children
 *    `expression_case` [field `value`=`expression_list`] / `default_case`) and
 *    `type_switch_statement` (fields `alias`?/`value`; children `type_case`
 *    [field `type`] / `default_case`) — cases do NOT fall through by default.
 *  - `fallthrough_statement` — EXPLICIT fallthrough to the next case (the
 *    opposite of C; modeled with a `fallthrough` edge).
 *  - `select_statement` (children `communication_case` [field `communication`=
 *    `receive_statement`/`send_statement`] / `default_case`).
 *  - `return_statement` (multiple-return via an `expression_list`),
 *    `break_statement` / `continue_statement` (BOTH may carry a `label_name`),
 *    `goto_statement` (`label_name` child), `labeled_statement` (field `label`=
 *    `label_name`).
 *  - `defer_statement` / `go_statement` — each wraps a `call_expression`.
 *
 * Edge-kind contract (matches the TS / Java / C# visitors — RD/CDG consume these):
 *  - if/else → `cond-true` / `cond-false`
 *  - for-loops (all four shapes) → `cond-true` / `loop-back` / `cond-false`
 *  - switch / select dispatch → `switch-case`; an explicit `fallthrough` → a
 *    `fallthrough` edge to the next case (Go cases otherwise do NOT fall through)
 *  - a `return` / normal completion threads through the active `defer` chain as
 *    `return` (first leg) + `finally-return` (each defer's completion leg)
 *  - return / break / continue → the matching terminator kind; a labeled
 *    `break outer;` / `continue outer;` targets the labeled frame, not the
 *    nearest one
 *  - straight-line → `seq`
 *
 * Go-specific modeling decisions (documented approximations — see the plan U5):
 *  - `defer f()`: deferred calls run at FUNCTION RETURN in LIFO order. Modeled as
 *    stacked completion legs (the {@link ControlFlowContext} finalizer machinery,
 *    Go's analogue of a `finally` route-through): each `defer` pushes a finalizer
 *    frame that stays active for the rest of the function, so every `return` AND
 *    the normal fall-off thread through ALL active defers innermost-first (LIFO).
 *    APPROXIMATION: a `defer` is registered at the point it executes, so a defer
 *    inside a not-yet-run branch is conservatively treated as active for the
 *    whole remaining function tail (Go would only run it if that branch ran). The
 *    panic/recover path is not modeled (documented gap).
 *  - `go f()`: spawns a goroutine — a SEPARATE flow. Decision (the simpler correct
 *    option): the `go` call is modeled as a normal straight-line statement in the
 *    CURRENT CFG and the spawned body is NOT followed inline. When the argument is
 *    a `go func(){…}()` closure, that `func_literal` is still collected as its OWN
 *    function by `isFunction` (the worker enumerates every function node), so its
 *    body gets a standalone CFG — nothing is dropped. A bare `go namedFn()` call's
 *    callee body lives in its own function CFG already. No edge is dropped, so no
 *    warning is logged for the common shapes.
 *  - `select {}` with no `default` BLOCKS forever; `for {}` (and `for cond {}`,
 *    and a `for {…}` with no `break`) may never terminate. Exactly as the sibling
 *    visitors emit a structural `header → loopExit` `cond-false` edge for
 *    `while(true)`, this visitor emits a structural exit-escape edge for EVERY
 *    for-loop shape AND for a `select` with no default, so EXIT stays
 *    reverse-reachable from every block — the post-dominator / CDG pass silently
 *    emits ZERO control-dependence for the function otherwise (CFG / REACHING_DEF
 *    survive; CDG goes to zero). This is the single highest-risk correctness
 *    property of the visitor.
 *
 * Classic hazards, handled explicitly (mirrors the Java / C# visitors):
 *  - loops allocate a dedicated loop-exit block so `break` has a target before
 *    the loop's successor is known; `continue` targets the header / update.
 *  - labeled `break outer;` / `continue outer;`: the label resolves against the
 *    frame of the construct it names (a labeled loop / switch / select), NOT the
 *    nearest enclosing frame. An UNLABELED break never targets a labeled-block
 *    frame (control-flow-context.ts enforces this).
 *  - `goto label;`: labels resolve within the function (forward AND backward);
 *    an unresolved `goto` (label in a sibling scope Go would reject, or malformed)
 *    routes to EXIT and logs, preserving single-exit.
 *
 * Known limitations:
 *  - `go`/goroutine inter-flow scheduling and channel happens-before are not
 *    modeled (each goroutine body is an independent CFG).
 *  - panic / recover: a `panic()` is a normal call here (no abnormal edge), and
 *    `recover()` inside a deferred closure is opaque; the panic-unwind path
 *    through defers is not modeled — documented gap, not faked.
 *  - Def/use harvest scope: see `go-harvest.ts` — selector / index / pointer
 *    writes are not scalar defs; `func_literal` bodies are opaque in both
 *    directions.
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** Go node types that own a CFG-bearing function body. */
declare const GO_FUNCTION_TYPES: Set<string>;
/** The Go CFG visitor. */
export declare function createGoCfgVisitor(): CfgVisitor<SyntaxNode>;
export { GO_FUNCTION_TYPES };
