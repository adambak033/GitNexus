/**
 * Ruby CfgVisitor (PDG layer beyond the C-family). Structurally closest to the
 * Python visitor — keyword/indentation-free blocks delimited by `end`,
 * statement-modifier forms (`expr if c`, `expr while c`), a
 * begin/rescue/else/ensure exception model (ensure = finally, rescue = catch,
 * the `else` runs if no exception), and `case`/`when` + `case`/`in` pattern
 * matching with no fallthrough. Ruby adds a few wrinkles the other visitors do
 * not have: `if`/`case`/`begin` are EXPRESSIONS, a method body is itself an
 * implicit `begin` (its `body_statement` can carry trailing `rescue`/`ensure`),
 * blocks (`do … end` / `{ … }`) and lambdas are their own CFG-bearing closures,
 * and `until` inverts the loop sense of `while`.
 *
 * Walks a Ruby `method` / `singleton_method` / block / `lambda`'s tree-sitter
 * AST and drives the language-agnostic {@link CfgBuilder} to produce a
 * serializable {@link FunctionCfg}, plus a def/use harvest
 * ({@link RubyHarvester}) for the reaching-defs / CDG solvers. Structured like
 * the Python / Go visitors — a `visit_<node_type>` dispatch over the statement
 * taxonomy, driving a per-function {@link ControlFlowContext} for break/continue
 * (next ≈ continue, redo ≈ loop-back) and the begin/ensure finalizer chain. NO
 * call-site `sites[]` are harvested (taint substrate is a later step — see
 * ruby-harvest.ts).
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-ruby via the introspection probe before use (mandatory pre-step).
 * Ruby shapes pre-empted (verified by a real parse):
 *  - functions: `method` / `singleton_method` (fields `name`/`parameters`/`body`;
 *    `body` is a `body_statement`). Blocks: `do_block` (`body` = `body_statement`)
 *    / `block` (`body` = `block_body`); `lambda` (`->(){}`; `body` = a `block`
 *    wrapping a `block_body`). The `lambda { }` keyword form is a `call` to
 *    `lambda` carrying a `block` — its block is collected as its own function.
 *  - `if` / `unless` fields `condition`/`consequence`(`then`)/`alternative`; the
 *    `alternative` is a nested `elsif` (own `condition`/`consequence`/`alternative`)
 *    or a trailing `else`. `if_modifier` / `unless_modifier` fields `body`/`condition`.
 *  - `while` / `until` fields `condition`/`body`(`do`); `while_modifier` /
 *    `until_modifier` fields `body`/`condition`. `for` fields `pattern`/`value`
 *    (an `in` wrapping the iterable) / `body`(`do`).
 *  - `case` fields `value` + `when` children (fields `pattern` (repeatable) /
 *    `body`(`then`)) + a trailing `else`. `case_match` (the `case … in` form)
 *    has fields `value` +
 *    `clauses`(`in_clause`, fields `pattern`/`guard`?(`if_guard`)/`body`) + an
 *    `else` field. No fallthrough in either.
 *  - `begin` directly holds its protected statements then typed `rescue` /
 *    `else` / `ensure` children (no field names). `rescue` fields
 *    `exceptions`?(`exceptions`)/`variable`?(`exception_variable`)/`body`(`then`).
 *    A method `body_statement` can carry the SAME trailing `rescue`/`else`/`ensure`
 *    children (an implicit begin). `rescue_modifier` fields `body`/`handler`.
 *  - `return` / `next` / `break` hold an optional `argument_list` child;
 *    `redo` / `retry` / `yield` are leaf-ish (`yield` may hold an `argument_list`).
 *
 * Edge-kind contract (matches the existing visitors — RD/CDG consume these):
 *  - if/unless/elsif/else → `cond-true` / `cond-false` (unless inverts the
 *    senses — its body is the cond-false arm)
 *  - while/until/for → `cond-true` / `loop-back` / `cond-false`; `until` inverts
 *    (its body runs while the condition is FALSE), still modeled with the same
 *    edge kinds (the loop body is `cond-true`, the exit `cond-false`)
 *  - case/when, case/in → `switch-case` (no fallthrough — like Go / Python match)
 *  - begin/rescue → `throw` (every protected-region block → each rescue handler);
 *    ensure completion → `finally-return` / `finally-break` / `finally-continue`
 *  - return → `return`; `break` → `break`; `next` ≈ continue → `continue`;
 *    `redo` → `loop-back` (re-enters the loop/block body); a jump crossing an
 *    `ensure` threads through it
 *  - straight-line → `seq`
 *
 * Ruby-specific modeling decisions (documented approximations):
 *  - a method body is an implicit `begin`: its `body_statement`'s trailing
 *    `rescue`/`else`/`ensure` children are modeled exactly like a `begin`.
 *  - `ensure` runs on BOTH the normal exit and an exception (finally semantics);
 *    the `rescue`-less `begin`/method re-propagates the exception after ensure.
 *  - `loop do … end` is `xs.loop`-shaped only when written as `loop { }`; the
 *    bare `loop do … end` is a `call` to `loop` carrying a `do_block`. The block
 *    body becomes its OWN function CFG (a closure), which — like `while true` —
 *    must still keep EXIT reverse-reachable. Inside the block, the structural
 *    exit-escape edge is emitted (the block body's normal fall-off reaches its
 *    EXIT). At the CALL site, the `loop … end` is a normal straight-line call.
 *  - `while true` (and any loop with no statically-false exit) STILL emits the
 *    structural `header → loopExit` `cond-false` edge so EXIT stays
 *    reverse-reachable and the post-dominator / CDG pass is not silently skipped.
 *    The single highest-risk correctness property of the visitor.
 *  - `retry` re-enters the nearest enclosing `begin` (its protected body); the
 *    edge is a `loop-back` to that begin's entry. Outside a begin it routes to
 *    EXIT (single-exit preserved) — a documented approximation.
 *  - `redo` re-runs the current loop/block body without re-testing the condition
 *    — modeled as a `loop-back` to the loop's continue target.
 *  - `if`/`case`/`begin` are EXPRESSIONS in Ruby (they have a value); as
 *    STATEMENTS they are modeled as control constructs. As an `assignment` RHS
 *    (`x = if c then 1 else 2 end` / `x = case k … end`) they are ALSO modeled as
 *    control flow now — the arms branch and the LHS binds at the rejoin (#2205,
 *    see {@link visitBindBranch}). Remaining inline (the same gap Java still has):
 *    a branch nested deeper in an expression (`x = f(if c …)`, `x = (if c …) + 1`)
 *    and an `operator_assignment` RHS (`x ||= if c …`).
 *
 * Known limitations:
 *  - `yield` is a normal expression here (no suspend/resume edge to the block
 *    passed by the caller); the generator-style resumption flow is not modeled.
 *  - `retry`'s re-enter target is the nearest lexical `begin`; a `retry` reached
 *    from a `rescue` whose begin is not on the active handler stack falls back to
 *    EXIT (documented approximation, not faked).
 *  - expression-position `case`/`begin`/`if` arms are inline (see above).
 *  - Def/use harvest scope: see ruby-harvest.ts — `@x`/`@@x`/`$x`/constant and
 *    index/attribute writes are not scalar defs; nested block / lambda bodies are
 *    opaque in both directions.
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** Ruby node types that own a CFG-bearing function/closure body. */
declare const RUBY_FUNCTION_TYPES: Set<string>;
/** The Ruby CFG visitor. */
export declare function createRubyCfgVisitor(): CfgVisitor<SyntaxNode>;
export { RUBY_FUNCTION_TYPES };
