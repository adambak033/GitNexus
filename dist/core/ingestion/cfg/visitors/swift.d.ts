/**
 * Swift CfgVisitor (#2195) — the VENDORED-GRAMMAR, control-keyword-overloaded
 * CFG target. Swift's tree-sitter grammar is unusual: a single
 * `control_transfer_statement` node represents `break` / `continue` / `return` /
 * `throw` (distinguished by its leading keyword child), there is no separate
 * `block` node (statement lists are bare `statements` nodes), optional binding
 * (`if let` / `guard let` / `while let`) is folded into the construct's
 * `condition` fields with no dedicated `if_let` node, and `defer` is parsed as a
 * `call_expression` to a `defer` identifier carrying a trailing-closure
 * `lambda_literal` (NOT a `defer_statement`). Every node type and field literal
 * below was grammar-validated against the vendored tree-sitter-swift via the
 * introspection probe before use (mandatory pre-step — the grammar-literal CI
 * gate maps `swift.ts → Swift`).
 *
 * The visitor drives the language-agnostic {@link CfgBuilder} to produce a
 * serializable {@link FunctionCfg} plus a def/use harvest ({@link SwiftHarvester})
 * for the reaching-defs / CDG solvers, structured like the sibling visitors — a
 * `visit_<node_type>` dispatch over the control-flow taxonomy driving a
 * per-function {@link ControlFlowContext} for labeled break/continue and the
 * `defer` completion chain (Swift's analogue of finally / Go-defer route-through).
 *
 * Swift shapes pre-empted (verified by a real parse):
 *  - functions: `function_declaration` / `init_declaration` / `deinit_declaration`
 *    (field `body`=`function_body`, which wraps a `statements`) and `lambda_literal`
 *    (a closure — `statements` follows an optional `lambda_function_type` + `in`).
 *  - `if_statement` field `condition` (a plain expr, or a `value_binding_pattern`
 *    +`bound_identifier`+value for `if let`); the THEN body is the first
 *    `statements`; an optional `else` keyword is followed by EITHER a nested
 *    `if_statement` (`else if`) OR the else-body `statements`.
 *  - `guard_statement` — like `if`, but its `else` `statements` MUST diverge
 *    (return/throw/break/continue); the guard body continues straight-line after.
 *  - `for_statement` fields `item`=`pattern` / `collection` / optional `where_clause`;
 *    body is the trailing `statements`.
 *  - `while_statement` field `condition` (may be a `value_binding_pattern` for
 *    `while let`); body `statements`.
 *  - `repeat_while_statement` — BOTTOM-TEST: body `statements` then the `while`
 *    keyword + `condition`.
 *  - `switch_statement` field `expr`; children `switch_entry` (each with a
 *    `switch_pattern` or `default_keyword`, an optional `where_keyword`+guard, a
 *    `statements` body, and an optional trailing `fallthrough` keyword child).
 *    Cases do NOT fall through implicitly; an explicit `fallthrough` spills to the
 *    next case.
 *  - `do_statement` — `statements` body + one or more `catch_block` (field
 *    `error`=`pattern`); `try_expression` (`try`/`try?`/`try!`).
 *  - `control_transfer_statement` — break / continue / return / throw, the first
 *    keyword child decides; `break outer` / `continue outer` carry the label as a
 *    `result` `simple_identifier`; `return x` / `throw e` carry the value.
 *  - `statement_label` (`outer:`) — a SIBLING preceding the labeled loop/switch in
 *    the same `statements`, NOT a wrapper.
 *
 * Edge-kind contract (matches the existing visitors — RD/CDG consume these):
 *  - if / else (incl. `if let`) → `cond-true` / `cond-false`
 *  - guard → `cond-true` (body continuation) / `cond-false` (the diverging else)
 *  - `for` / `while` / `while let` → `cond-true` / `loop-back` / `cond-false`
 *  - `repeat … while` → bottom-test: body runs first, condition `loop-back` (true)
 *    / `cond-false` (exit)
 *  - `switch` dispatch → `switch-case` (NO implicit fallthrough); an explicit
 *    `fallthrough` → a `fallthrough` edge to the next case
 *  - `do`/`catch` → `throw` (each protected block edges to the first handler)
 *  - a `defer` (and the normal completion / each `return`) threads through the
 *    active defer chain as `return` (first leg) + `finally-return` (each defer's
 *    completion leg), LIFO
 *  - return / throw / break / continue → the matching terminator kind; a labeled
 *    `break outer` / `continue outer` targets the labeled loop frame
 *  - straight-line → `seq`
 *
 * Swift-specific modeling decisions (documented approximations):
 *  - `defer { … }` runs at SCOPE EXIT in LIFO order. Modeled exactly as the Go
 *    visitor models Go's `defer`: each registers a finalizer frame that stays
 *    active for the rest of the function tail, so every later `return` AND the
 *    normal fall-off thread through ALL active defers innermost-first. APPROXIMATION:
 *    a `defer` is registered at the point it executes, so a defer inside a
 *    not-yet-run branch is conservatively treated as active for the whole remaining
 *    function tail. Swift `defer` is scope-bound (block-level), not function-bound;
 *    modeling it as function-tail-bound is a sound over-approximation for v1.
 *  - `while true {}` / `repeat {} while true` may never terminate; like the
 *    C-family / Go / Rust visitors, this visitor ALWAYS emits the structural
 *    `header → loopExit` `cond-false` escape edge so EXIT stays reverse-reachable
 *    and the post-dominator / CDG pass is not silently skipped for the function.
 *    This is the single highest-risk correctness property.
 *  - `try` / `try?` / `try!` and a `throw` inside a `do` route to the enclosing
 *    `catch` conservatively (every protected block → the first handler, matching
 *    the C++/TS over-approximation). A `throw` with no enclosing `do/catch` routes
 *    to EXIT (the function propagates the error to its caller).
 *  - a closure (`lambda_literal`) is collected as its OWN function by `isFunction`,
 *    so its body gets a standalone CFG; in the ENCLOSING function it is an opaque
 *    straight-line value (its body is not followed inline) — except a `defer`'s
 *    trailing closure, which is unwrapped to model scope-exit flow.
 *
 * Known limitations:
 *  - a value-position `if`/`switch` (Swift 5.9) IS modeled as control flow in two
 *    carriers (#2207): a `let x = if … else … / switch … {…}` binding (arms rejoin
 *    at a binding continuation) and `return if … / switch …` (each arm returns).
 *    tree-sitter-swift reuses `if_statement` / `switch_statement` for the value
 *    form. A value branch in any OTHER position (an argument, an interpolation)
 *    stays inline; the ternary `?:` / `??` are excluded by design.
 *  - computed properties (`var y: Int { get { … } set { … } }`) have their bodies
 *    inside `computed_getter` / `computed_setter` rather than a function node; v1
 *    does NOT build a CFG for them (documented gap, not faked).
 *  - `async` / `await`: suspension points are normal straight-line flow (no
 *    scheduler edges). `Task { … }` closures get their own CFG like any closure.
 *  - block-scope shadowing in the harvest is flattened to one function table (see
 *    swift-harvest.ts) — a documented v1 over-approximation.
 *  - the panic-like `fatalError()` / forced-unwrap traps abort abnormally but
 *    tree-sitter sees a normal call — that abnormal path is not modeled.
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** Swift node types that own a CFG-bearing function body. */
declare const SWIFT_FUNCTION_TYPES: Set<string>;
/** The Swift CFG visitor. */
export declare function createSwiftCfgVisitor(): CfgVisitor<SyntaxNode>;
export { SWIFT_FUNCTION_TYPES };
