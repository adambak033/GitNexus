/**
 * Python CfgVisitor — the most STRUCTURALLY DIVERGENT CFG target (PDG layer
 * beyond the C-family). Python has no braces (suites are indented `block` nodes),
 * `elif` clauses, `for`/`while ... else` (the else runs on NORMAL completion, not
 * on `break`), `with` (deterministic `__exit__` on both normal AND exception
 * exit — a try/finally analogue), `try` / `except` / `except-group` (except-star)
 * / `else` / `finally`, and `match`/`case` (no fallthrough). A good stress test
 * that the shared CFG core
 * carries no hidden brace-family assumptions.
 *
 * Walks a Python `function_definition` / `lambda`'s tree-sitter AST and drives
 * the language-agnostic {@link CfgBuilder} to produce a serializable
 * {@link FunctionCfg}, plus a def/use harvest ({@link PythonHarvester}) for the
 * reaching-defs / CDG solvers. Structured like the C-family visitors — a
 * `visit_<node_type>` dispatch over the statement taxonomy, driving a
 * per-function {@link ControlFlowContext} for break/continue and the `with` /
 * `finally` completion chain (finalizer route-through). NO call-site `sites[]`
 * are harvested (taint substrate is a later step — see python-harvest.ts).
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-python (0.23.x) via the introspection probe before use (mandatory
 * pre-step). Python shapes pre-empted (verified by a real parse):
 *  - functions: `function_definition` (fields `name`/`parameters`/`body`; async
 *    is the SAME node with an `async` token child), `lambda` (fields
 *    `parameters`/`body`; the body is an EXPRESSION, not a `block`).
 *  - `if_statement` fields `condition`/`consequence` plus ZERO-OR-MORE
 *    `alternative` fields, each an `elif_clause` (fields `condition`/`consequence`)
 *    or an `else_clause` (field `body`) — Python has no nested-`if` else chain.
 *  - `for_statement` fields `left`/`right`/`body` + optional `alternative`
 *    (`else_clause`); `while_statement` fields `condition`/`body` + optional
 *    `alternative` (`else_clause`). The loop `else` runs on the cond-false /
 *    normal-completion path, NOT on `break`.
 *  - `with_statement` field `body`; a `with_clause` of `with_item`s (field
 *    `value` = `as_pattern` or a bare expression). `__exit__` runs on normal AND
 *    exception exit — modeled as a finalizer (try/finally analogue).
 *  - `try_statement` field `body`; children `except_clause` /
 *    `except_group_clause` (each holds the exception expr/`as_pattern` + a
 *    `block`), `else_clause` (field `body`, runs if NO exception), and
 *    `finally_clause` (holds a `block`).
 *  - `match_statement` fields `subject`/`body`; the `body` `block` holds
 *    `case_clause`s (field `alternative`), each with `case_pattern` child(ren),
 *    an optional `guard` (`if_clause`), and a `consequence` `block`. No
 *    fallthrough between cases.
 *  - `return_statement` / `raise_statement` / `break_statement` /
 *    `continue_statement` / `pass_statement`.
 *
 * Edge-kind contract (matches the existing visitors — RD/CDG consume these):
 *  - if/elif/else → `cond-true` / `cond-false`
 *  - for/while → `cond-true` / `loop-back` / `cond-false`; the loop `else` runs
 *    on the `cond-false` / normal-completion path (NOT on `break`)
 *  - match dispatch → `switch-case` (no fallthrough — like Go's switch)
 *  - try/except → `throw` (every protected block → each except handler)
 *  - a `break`/`continue`/`return` crossing a `with` `__exit__` or a `finally`
 *    threads through as `break`/`continue`/`return` (first leg) +
 *    `finally-break`/`finally-continue`/`finally-return` (each completion leg)
 *  - return/raise/break/continue → the matching terminator kind
 *  - straight-line → `seq`
 *
 * Python-specific modeling decisions (documented approximations):
 *  - `with EXPR as t:` runs the body then `__exit__` deterministically on BOTH
 *    the normal exit and an exception (it can suppress the exception, but the
 *    common case re-raises). Modeled exactly like `try/finally`: a finalizer
 *    frame for the body's exit-dispose, with the protected body edging the
 *    dispose block on `throw`. APPROXIMATION: exception SUPPRESSION by a context
 *    manager is not modeled (the dispose re-propagates), the sound direction.
 *  - the loop `else` clause runs once on normal completion (the loop ran to
 *    exhaustion without `break`). It sits on the `cond-false` edge BEFORE the
 *    join; a `break` targets the loop exit AFTER the else, so `break` skips it.
 *  - `match`/`case` cases do NOT fall through (like Go). The dispatch fans a
 *    `switch-case` edge to each case body; a guarded / non-wildcard tail with no
 *    `case _` also reaches the join directly (no-match path), keeping EXIT
 *    reverse-reachable.
 *  - `while True:` (and any loop with no statically-false exit) STILL emits the
 *    structural `header → loopExit` `cond-false` edge — exactly like the
 *    C-family visitors — so EXIT stays reverse-reachable and the post-dominator /
 *    CDG pass is not silently skipped for the function. Highest-risk property.
 *  - `lambda` has an EXPRESSION body (no `block`): one block whose value is the
 *    returned expression.
 *  - comprehensions are harvested for their target bindings but kept INLINE (no
 *    separate CFG blocks) — the plan's explicit choice.
 *
 * Known limitations:
 *  - async (`async def`, `await`, `async for`, `async with`) is the same node
 *    shape as the sync form plus an `async` token; the suspension points are
 *    modeled as normal straight-line control flow (no scheduler edges).
 *  - generators (`yield` / `yield from`): a `yield` is a normal expression here
 *    (no suspend/resume edge); the generator's resumption flow is not modeled.
 *  - comprehension target scoping: comprehension targets are declared in the
 *    single function table (Python 3 gives them their own scope; the leaked-name
 *    distinction is not modeled) — see python-harvest.ts.
 *  - context-manager exception SUPPRESSION and `recover`-style flow are not
 *    modeled (the `with` dispose always re-propagates).
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** Python node types that own a CFG-bearing function body. */
declare const PY_FUNCTION_TYPES: Set<string>;
/** The Python CFG visitor. */
export declare function createPythonCfgVisitor(): CfgVisitor<SyntaxNode>;
export { PY_FUNCTION_TYPES };
