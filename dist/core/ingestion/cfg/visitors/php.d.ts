/**
 * PHP CfgVisitor (PDG layer — brace-family, closest to Java/C#).
 *
 * Walks a PHP function / method / closure / arrow-function tree-sitter AST and
 * drives the language-agnostic {@link CfgBuilder} to produce a serializable
 * {@link FunctionCfg}, plus a def/use harvest ({@link PhpHarvester}) for the
 * reaching-defs / CDG solvers. Structured like the Java / C# visitors — a
 * `visit_<node_type>` dispatch over the statement taxonomy, driving a
 * per-function {@link ControlFlowContext} — because PHP shares their `finally`
 * semantics (try/catch/finally) and C-style switch FALLTHROUGH.
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-php (`php_only` export) via the introspection probe before use
 * (mandatory pre-step). PHP shapes pre-empted (verified by a real parse):
 *  - functions: `function_definition` / `method_declaration` (fields
 *    `name`/`parameters`/`body`, body a `compound_statement`),
 *    `anonymous_function` (`parameters`/`body` + `anonymous_function_use_clause`),
 *    `arrow_function` (`parameters`/`body`; body is an EXPRESSION).
 *  - `if_statement` field `condition` (a `parenthesized_expression`), `body`, and
 *    zero-or-more `alternative` fields, each an `else_if_clause`
 *    (`condition`/`body`) or a trailing `else_clause` (`body`). PHP has no nested-
 *    `if` else chain — `elseif` is its own clause. The ALTERNATIVE colon syntax
 *    (`if … : … elseif … : … else: … endif;`) parses to the SAME node types with
 *    a `colon_block` body instead of `compound_statement`, so reading the `body`
 *    field handles both uniformly.
 *  - `for_statement` fields `initialize` / `condition` / `update` / `body` (NOT
 *    `init`/`incr`); `foreach_statement` field `body` plus POSITIONAL children:
 *    the iterable `variable_name`, then a value `variable_name` OR a `pair`
 *    (`$k => $v`); `while_statement` (`condition`/`body`); `do_statement`
 *    (`body`/`condition`).
 *  - `switch_statement` (`condition`/`body` = `switch_block`); the block holds
 *    `case_statement` (field `value`, body statements are siblings — FALLS
 *    THROUGH) and `default_statement`. `match_expression` (`condition`/`body` =
 *    `match_block`) is a value-position expression with NO fallthrough.
 *  - `try_statement` field `body`; `catch_clause` (`type`/`name`/`body`),
 *    `finally_clause` (`body`).
 *  - `return_statement`; `break_statement` / `continue_statement` carry an
 *    optional `integer` child (`break 2;` targets the 2nd enclosing loop/switch);
 *    `throw` is a `throw_expression` wrapped in an `expression_statement` (there
 *    is NO `throw_statement` node); `goto_statement` + `named_label_statement`.
 *
 * Edge-kind contract (matches the existing visitors — RD/CDG consume these):
 *  - if/elseif/else → `cond-true` / `cond-false`
 *  - loops (for / foreach / while / do-while) → `cond-true` / `loop-back` /
 *    `cond-false`
 *  - switch → `switch-case` / `fallthrough` (a `case` with no `break`/`return`
 *    falls through to the next case); a value-position `match` with ≥2 arms also
 *    dispatches as `switch-case` (no fallthrough), see the limitations.
 *  - try/catch → `throw` (every protected-region block → the handler); a
 *    `finally` runs on normal AND exception exit, so a `return`/`break`/`continue`
 *    crossing it gets a `finally-*` completion edge.
 *  - return / throw / break / continue → the matching terminator kind; `break N`
 *    / `continue N` target the N-th enclosing loop/switch (not the nearest).
 *  - straight-line → `seq`
 *
 * Classic hazards, handled explicitly (mirrors the Java / TS visitors):
 *  - loops allocate a dedicated loop-exit block so `break` has a target before
 *    the loop's successor is known; `continue` targets the header / update.
 *  - `for (;;) {}` / `while (true) {}` still emit the structural `header →
 *    loopExit` `cond-false` escape edge so EXIT stays reverse-reachable from
 *    every block — the post-dominator / CDG pass silently emits zero CDG for the
 *    function otherwise.
 *  - `break N` / `continue N`: each loop/switch frame is pushed with a UNIQUE
 *    synthetic label, and an N-level jump resolves against the label of the N-th
 *    enclosing loop/switch frame — reusing the existing finalizer-threading
 *    machinery so a jump that crosses a `finally` still threads through it.
 *  - try/catch: conservative exceptional flow — EVERY block in the protected
 *    region edges to the handler (an exception may fire mid-block).
 *
 * Known limitations:
 *  - A value-position `match($x) { … }` with ≥2 arms IS modeled as a `switch-case`
 *    dispatch in two carriers (#2207): an `$x = match(…) {…}` assignment (arms
 *    rejoin at a binding continuation) and `return match(…) {…}` (each arm
 *    returns). A `match` in any OTHER position — a call argument, a nested
 *    subexpression — stays INLINE inside its owning block. The ternary `?:` is
 *    excluded by design (a micro-branch, like elvis in Kotlin).
 *  - context-manager-style suppression and PHP's exception-from-mid-call outside
 *    any `try` are not modeled (no edge), matching the other visitors.
 *  - `goto` / named labels are modeled as straight-line blocks (the label is a
 *    plain block; a `goto` does NOT create a jump edge — PHP `goto` is rare and
 *    intra-function only; an over-approximation here would harm precision more
 *    than the missing edge). Documented gap.
 *  - Def/use harvest scope: see `php-harvest.ts` — property / array-element
 *    writes are not scalar defs; nested-function (closure / arrow) bodies are
 *    opaque in both directions.
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** PHP node types that own a CFG-bearing function body. */
declare const PHP_FUNCTION_TYPES: Set<string>;
/** The PHP CFG visitor. */
export declare function createPhpCfgVisitor(): CfgVisitor<SyntaxNode>;
export { PHP_FUNCTION_TYPES };
