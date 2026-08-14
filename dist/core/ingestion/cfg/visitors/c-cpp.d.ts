/**
 * C / C++ CfgVisitor (#2195 U2, plan KTD1).
 *
 * Walks a C or C++ function's tree-sitter AST and drives the language-agnostic
 * {@link CfgBuilder} to produce a serializable {@link FunctionCfg}, plus a
 * def/use harvest ({@link CCppHarvester}) for the reaching-defs / CDG solvers.
 *
 * SHARED CORE, TWO FACTORIES. A grammar-introspection probe (mandatory pre-step,
 * KTD1) confirmed every control-flow node type and field this visitor uses is
 * IDENTICAL between tree-sitter-c and tree-sitter-cpp — `if_statement`,
 * `for_statement`, `while_statement`, `do_statement`, `switch_statement` /
 * `case_statement`, `return`/`break`/`continue`/`goto_statement` /
 * `labeled_statement`, `compound_statement`, and the `condition`/`consequence`/
 * `alternative`/`initializer`/`update`/`body`/`label`/`value` fields. So the C
 * walk ({@link CCfgWalk}) is grammar-shared, and C++ EXTENDS it ({@link
 * CppCfgWalk}) with exception flow (`try_statement` / `catch_clause` /
 * `throw_statement`) and `for_range_loop` — node types that simply never occur
 * in a C parse, so there is no `if (lang === …)` branching (AGENTS.md
 * no-language-naming rule). The two factories differ only in which walk class
 * and function-node set they install.
 *
 * Edge-kind contract (matches the TS visitor — RD/CDG consume these):
 *  - if/else → `cond-true` / `cond-false`
 *  - loops (for / while / do-while / for-range) → `cond-true` / `loop-back` /
 *    `cond-false`
 *  - switch → `switch-case` / `fallthrough` (C-style: a case body that does not
 *    `break` falls into the next case)
 *  - try/catch (C++) → `throw` (every protected-region block → the handler)
 *  - return / throw / break / continue → the matching terminator kind
 *  - straight-line → `seq`
 *
 * Classic hazards, handled explicitly:
 *  - loops allocate a dedicated loop-exit block so `break` has a target before
 *    the loop's successor is known; `continue` targets the header/increment.
 *  - `for (;;) {}` / `while (1) {}` still emit the structural `header → loopExit`
 *    `cond-false` escape edge so EXIT stays reverse-reachable from every block —
 *    the post-dominator / CDG pass is unsound otherwise (it silently emits zero
 *    CDG for the function).
 *  - C `goto`/`labeled_statement`: labels resolve within the function (forward
 *    AND backward); an unresolved `goto` (label not in this function) routes to
 *    EXIT and logs via the builder warn path, preserving single-exit.
 *  - C++ `try`/`catch`: conservative exceptional flow — EVERY block in the
 *    protected region edges to the handler (an exception may fire mid-block),
 *    matching the TS `visitTry` over-approximation. A `throw` with no enclosing
 *    try routes to EXIT.
 *
 * Known limitations:
 *  - C++ RAII: a destructor runs implicitly at scope exit, but tree-sitter does
 *    NOT represent that call in the AST. This visitor therefore does NOT model
 *    destructor-at-scope-exit control/data flow — it is a documented gap, not
 *    faked. (C++ has no `finally`; `try`/`catch` is the only modeled exception
 *    construct, so the TS finalizer-frame machinery is unused here.)
 *  - A `goto` whose label is undefined in the function keeps the conservative
 *    route-to-EXIT fallback (single-exit preserved; the continuation path is
 *    approximate). `setjmp`/`longjmp` non-local control is not modeled.
 *  - Computed `goto` (`goto *ptr;`, a GNU extension) has no static label target
 *    and routes to EXIT like an unresolved label.
 *  - Def/use harvest scope: see `c-cpp-harvest.ts` — member/pointer/array writes
 *    are not scalar defs; C++ lambda bodies are opaque in both directions.
 *
 * Returns `undefined` (never throws) for an AST shape it cannot model, so a
 * malformed function never drops the whole file's CFG group (R4).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** C function node — only `function_definition` owns a CFG-bearing body. */
declare const C_FUNCTION_TYPES: Set<string>;
/** C++ adds the lambda as a CFG-bearing function. */
declare const CPP_FUNCTION_TYPES: Set<string>;
/** The C CFG visitor. */
export declare function createCCfgVisitor(): CfgVisitor<SyntaxNode>;
/** The C++ CFG visitor (C core + exceptions + range-for + lambdas). */
export declare function createCppCfgVisitor(): CfgVisitor<SyntaxNode>;
export { C_FUNCTION_TYPES, CPP_FUNCTION_TYPES };
