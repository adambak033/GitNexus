/**
 * Rust CfgVisitor (#2195 U7) — the EXPRESSION-ORIENTED CFG target. Unlike the
 * C-family / Go / Python visitors (statement languages), Rust control flow is
 * built from EXPRESSIONS: `if` / `loop` / `while` / `for` / `match` / `block`
 * are all expressions that produce a value. The visitor still drives the
 * language-agnostic {@link CfgBuilder} to produce a serializable
 * {@link FunctionCfg} plus a def/use harvest ({@link RustHarvester}) for the
 * reaching-defs / CDG solvers, structured like the sibling visitors — a
 * `visit_<node_type>` dispatch over the control-flow taxonomy driving a
 * per-function {@link ControlFlowContext} for labeled break/continue.
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-rust via the introspection probe before use (mandatory pre-step).
 * Rust shapes pre-empted (verified by a real parse):
 *  - functions: `function_item` (fields `name`/`parameters`/`return_type`/`body`;
 *    a method is a `function_item` inside an `impl_item`'s `declaration_list`)
 *    and `closure_expression` (field `parameters`=`closure_parameters`; `body` is
 *    a `block` OR a bare expression — `|x| x + 1`).
 *  - `if_expression` fields `condition` / `consequence` (a `block`) /
 *    `alternative` (an `else_clause` wrapping a `block` or a nested
 *    `if_expression` of an `else if`). The condition can be a `let_condition`
 *    (`if let PAT = e`) or a `let_chain` (`if let PAT = e && cond`).
 *  - `loop_expression` field `body` — the INFINITE loop (NO `condition` field);
 *    an optional `label` NAMED CHILD (label is NOT a field). The key
 *    non-terminating case.
 *  - `while_expression` fields `condition` (may be a `let_condition` for
 *    `while let`) / `body`; optional `label` named child.
 *  - `for_expression` fields `pattern` / `value` / `body`; optional `label`
 *    named child.
 *  - `match_expression` fields `value` / `body` (a `match_block` of `match_arm`s).
 *    A `match_arm` has field `pattern` (a `match_pattern`, which may carry an `if`
 *    guard with field `condition`) and field `value` (the arm body — an
 *    expression or a `block`). Arms do NOT fall through.
 *  - `break_expression` — optional `label` named child AND an optional value
 *    expression (`break 'a 42`). `continue_expression` — optional `label`.
 *  - `return_expression` — optional value child. `try_expression` (`expr?`) —
 *    the early-return operator.
 *  - a `label` node's bare name is its `identifier` child's text (`'outer`'s name
 *    is `outer`), matching `break 'outer` / `continue 'outer`.
 *
 * Edge-kind contract (matches the existing visitors — RD/CDG consume these):
 *  - if / else (incl. `if let`) → `cond-true` / `cond-false`
 *  - `loop {}` (no condition) → `loop-back` (body re-enters) PLUS a structural
 *    `cond-false` escape edge (header → loopExit) so EXIT stays reverse-reachable
 *  - `while` / `while let` / `for` → `cond-true` / `loop-back` / `cond-false`
 *  - `match` dispatch → `switch-case` (NO fallthrough — like Go / Python)
 *  - `break` / `continue` / `return` → the matching terminator kind; a labeled
 *    `break 'outer` / `continue 'outer` targets the labeled loop frame; a
 *    `break value` is still a `break` edge
 *  - the `?` operator (`try_expression`) → `throw` — an early error-return edge to
 *    EXIT from the `?` site (a conservative throw-like edge; the Err/None path)
 *  - straight-line → `seq`
 *
 * Rust-specific modeling decisions (documented approximations):
 *  - `loop {}` is the canonical Rust infinite loop with NO condition. We ALWAYS
 *    emit a structural `header → loopExit` escape edge (exactly as the C-family /
 *    Go visitors do for `while(true)` / `for {}`), so EXIT stays reverse-reachable
 *    and the post-dominator / CDG pass is not silently skipped for the function.
 *    This is the single highest-risk correctness property. A `loop {}` that
 *    DOES `break` also reaches EXIT via the break; the structural escape edge is
 *    emitted either way.
 *  - the `?` operator desugars to a `match` that returns the Err/None early. We
 *    model it conservatively as a `throw` edge to the function EXIT from the block
 *    that contains the `?` — so the post-`?` continuation stays reachable (the Ok
 *    path) AND the early-exit path is represented. Multiple `?` in one block emit
 *    one early-exit edge per `?`-bearing block (deduped by the builder).
 *  - a closure (`closure_expression`) is collected as its OWN function by
 *    `isFunction`, so its body gets a standalone CFG; in the ENCLOSING function it
 *    is an opaque straight-line value (its body is not followed inline), exactly
 *    as the Go visitor treats a spawned closure and the TS visitor an arrow body.
 *  - the trailing tail expression of a `block` (no `;`) is the block's value; for
 *    control-flow purposes it just falls off normally to the block's successor.
 *
 * Known limitations:
 *  - panic: a `panic!()` (or an out-of-bounds index, an `unwrap` on `None`) aborts
 *    the function abnormally, but tree-sitter sees only a normal macro/method call.
 *    The panic-unwind path is NOT modeled (documented gap, not faked) — Rust has
 *    no try/catch, so there is no handler structure to route to.
 *  - async (`async fn`, `.await`): the suspension points are modeled as normal
 *    straight-line control flow (no scheduler edges).
 *  - block scope + shadowing in the def/use harvest is flattened to one function
 *    table (see rust-harvest.ts) — a documented v1 over-approximation.
 *  - macro bodies (`println!`, `vec!`, custom macros) are opaque token trees — any
 *    control flow expanded by a macro is invisible.
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** Rust node types that own a CFG-bearing function body. */
declare const RUST_FUNCTION_TYPES: Set<string>;
/** The Rust CFG visitor. */
export declare function createRustCfgVisitor(): CfgVisitor<SyntaxNode>;
export { RUST_FUNCTION_TYPES };
