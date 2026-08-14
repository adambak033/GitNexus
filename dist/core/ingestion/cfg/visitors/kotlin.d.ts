/**
 * Kotlin CfgVisitor (#2195) — the VENDORED-GRAMMAR JVM/brace-family CFG target.
 *
 * Kotlin's tree-sitter grammar (vendored, NOT an npm package — loaded via
 * `requireVendoredGrammar('tree-sitter-kotlin')`, exactly like tree-sitter-swift)
 * is field-less for control flow: NONE of the control-flow nodes expose
 * `childForFieldName` fields (verified by a real parse — every `fieldNameForChild`
 * came back null), so this visitor navigates purely by child TYPE and position.
 * Every node-type literal below was grammar-validated against the vendored
 * tree-sitter-kotlin via the introspection probe before use (mandatory pre-step —
 * the grammar-literal CI gate maps `kotlin.ts → Kotlin` and fails on a wrong
 * literal).
 *
 * Structured like the Java / C# visitors — a `visit_<node_type>` dispatch over the
 * statement taxonomy driving a per-function {@link ControlFlowContext} — because
 * Kotlin shares JVM `finally` semantics (try/catch/finally + labeled
 * break/continue), which the finalizer-frame + labeled-frame machinery in
 * `control-flow-context.ts` models.
 *
 * Kotlin's defining quirk: `if` / `when` / `try` are EXPRESSIONS. The visitor
 * treats each as a control-flow construct when it appears in STATEMENT position
 * (a direct child of a `statements` list) and as opaque straight-line value when
 * nested inside an expression (e.g. `val y = if (x) 1 else 2`) — exactly the
 * Java statement-vs-value-switch split.
 *
 * Kotlin shapes pre-empted (verified by a real parse):
 *  - functions: `function_declaration` (name `simple_identifier`,
 *    `function_value_parameters`, optional `: user_type`, `function_body`),
 *    `anonymous_function` (`fun (...) function_body`), and `lambda_literal`
 *    (`{ lambda_parameters? -> statements }`). A `function_body` is either
 *    `{ statements }` OR an expression body `= expr` (no `statements` wrapper).
 *  - `if_expression`: `if ( COND ) control_structure_body [ else
 *    (control_structure_body | if_expression) ]`. No `else_clause` wrapper — an
 *    `else if` is the nested `if_expression` after the `else` keyword.
 *  - `when_expression`: `when when_subject? { when_entry* }`. A `when_subject` is
 *    `( expr )` or `( val v = expr )`. A `when_entry` is `when_condition*` (comma
 *    separated, OR an `else` keyword) `-> control_structure_body`. Arms do NOT
 *    fall through. A `when_condition` may wrap a `range_test` (`in 1..10`),
 *    `type_test` (`is T` / `!is T`), or a plain expression.
 *  - `for_statement`: `for ( (variable_declaration | multi_variable_declaration)
 *    in COLLECTION ) control_structure_body`.
 *  - `while_statement`: `while ( COND ) control_structure_body`.
 *  - `do_while_statement` — BOTTOM-TEST: `do control_structure_body while ( COND )`.
 *  - `try_expression`: `try { statements } catch_block* finally_block?`. A
 *    `catch_block` is `catch ( simple_identifier : user_type ) { statements }`;
 *    a `finally_block` is `finally { statements }`.
 *  - `jump_expression` — `return [expr]` / `return@label` / `break` / `break@label`
 *    / `continue` / `continue@label` / `throw expr`. The leading anonymous keyword
 *    child (`return` / `return@` / `break` / `break@` / `continue` / `continue@` /
 *    `throw`) decides; a labeled jump carries a `label` named child.
 *  - `label` — a labeled loop is preceded by a SIBLING `label` (`outer@`) in the
 *    same `statements`, NOT a wrapper; the jump's target label child is `outer`.
 *  - `control_structure_body` wraps either `{ statements }` or a single bare
 *    statement (`if (c) a()`).
 *
 * Edge-kind contract (matches the existing visitors — RD/CDG consume these):
 *  - if / else → `cond-true` / `cond-false`
 *  - `when` dispatch → `switch-case` (NO fallthrough — each arm rejoins after)
 *  - `for` / `while` → `cond-true` / `loop-back` / `cond-false`
 *  - `do … while` → bottom-test: body runs first, condition `loop-back` (true) /
 *    `cond-false` (exit)
 *  - try/catch → `throw` (every protected-region block → the handler); a
 *    `finally` runs on BOTH normal and exception exit, so a `return`/`break`/
 *    `continue` crossing it threads through it (`finally-*` completion edges).
 *  - return(@label) / throw / break(@label) / continue(@label) → the matching
 *    terminator kind; a labeled jump targets the labeled loop frame.
 *  - straight-line → `seq`
 *
 * Classic hazards, handled explicitly (mirrors Java / C# / Swift):
 *  - loops allocate a dedicated loop-exit block so `break` has a target before the
 *    loop's successor is known; `continue` targets the header.
 *  - `while (true) {}` / `do {} while (true)` still emit the structural `header →
 *    loopExit` `cond-false` escape edge so EXIT stays reverse-reachable from every
 *    block — the post-dominator / CDG pass silently emits zero CDG otherwise. This
 *    is the single highest-risk correctness property.
 *  - labeled `break@outer` / `continue@outer`: the label resolves against the
 *    labeled loop frame, NOT the nearest one.
 *  - try/catch: conservative exceptional flow — EVERY block in the protected
 *    region edges to the handler (an exception may fire mid-block), matching the
 *    Java/C#/TS over-approximation.
 *
 * Kotlin-specific modeling decisions (documented approximations):
 *  - a value-position `if` (with `else`) / `when` (≥2 arms) / `try` IS modeled as
 *    control flow (#2205) in four carriers: a `val/var x = <branch>` binding, an
 *    `x = <branch>` assignment, a `return <branch>`, and a `fun f() = <branch>`
 *    expression body — its arms become separate CFG blocks that rejoin at a
 *    binding/return continuation. A branch in any OTHER value position — nested in
 *    a call argument (`f(when …)`), a deeper subexpression — is left INLINE (the
 *    value flows to the consumer in one block). The ternary-like `?:` (elvis) and
 *    `?.` micro-branches are excluded by design.
 *  - a `lambda_literal` / nested `anonymous_function` / nested
 *    `function_declaration` is collected as its OWN function by `isFunction`, so
 *    its body gets a standalone CFG; in the ENCLOSING function it is an opaque
 *    straight-line value (its body is not followed inline). A `return@label`
 *    inside a lambda routes to the lambda's OWN EXIT (the lambda is its own CFG).
 *  - a `throw` with no enclosing `try`/`catch` routes to EXIT (the function
 *    propagates the exception to its caller), matching Java.
 *
 * Known limitations:
 *  - `?.` safe-call and `?:` elvis short-circuit are NOT modeled as branches —
 *    their conditional sub-evaluation is a HARVEST may-def concern (see
 *    kotlin-harvest.ts), not a CFG split (consistent with the TS `&&`/`??`
 *    treatment, which also stays in one block).
 *  - secondary-constructor `constructor(...)` bodies and property getters/setters
 *    are NOT function nodes in this grammar's CFG-bearing set; v1 does not build a
 *    CFG for them (documented gap).
 *  - `inline fun` non-local returns: a `return` inside an inline-lambda argument
 *    can return from the ENCLOSING function in real Kotlin; the lambda is modeled
 *    as its own CFG (the conservative, sound-for-RD direction), so that non-local
 *    return is not threaded into the enclosing function — a documented v1 gap.
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** Kotlin node types that own a CFG-bearing function body. */
declare const KOTLIN_FUNCTION_TYPES: Set<string>;
/** The Kotlin CFG visitor. */
export declare function createKotlinCfgVisitor(): CfgVisitor<SyntaxNode>;
export { KOTLIN_FUNCTION_TYPES };
