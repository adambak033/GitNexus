/**
 * Extract C++ template constraint expressions for SFINAE-aware overload
 * narrowing (issue #1579). Recognizes 3 AST shapes:
 *
 *   F1 — unqualified non-type template param default:
 *        `template<class T, enable_if_t<P, int> = 0> void f(T);`
 *   F2 — `std::`-qualified variant (canonical ticket form):
 *        `template<class T, std::enable_if_t<P, int> = 0> void f(T);`
 *   F4 — C++20 leading requires-clause:
 *        `template<class T> requires P void f(T);`
 *
 * Deferred (return `{kind:'unknown'}`):
 *   F3 — void-default `typename = enable_if_t<P>` (cppref labels this
 *        `/* WRONG *\/` because adjacent overloads collapse to redeclarations)
 *   F5 — trailing requires (`void f(T) requires P;`)
 *   `requires_expression` blocks (`requires { typename T::U; }`)
 *   `decltype(...)`, fold-expressions, user-defined `_v` aliases.
 *
 * The output payload is opaque to shared code — only
 * `constraint-filter.ts` consumes it. See ISO `[temp.constr.normal]` /
 * `<https://en.cppreference.com/w/cpp/language/constraints>` for the
 * normalization the Kleene 3-valued evaluator implements.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
export type ConstraintExpr = {
    readonly kind: 'atomic';
    readonly name: string;
    readonly args: readonly string[];
} | {
    readonly kind: 'and';
    readonly children: readonly ConstraintExpr[];
} | {
    readonly kind: 'or';
    readonly children: readonly ConstraintExpr[];
} | {
    readonly kind: 'not';
    readonly child: ConstraintExpr;
} | {
    readonly kind: 'unknown';
};
export interface CppConstraintPayload {
    /** Ordered template parameter names (type-params only — non-type defaults
     *  carrying enable_if predicates are folded into `expr`). */
    readonly templateParams: readonly string[];
    /**
     * Mapping from each template parameter name to the call-site argument
     * index where its deduced type lives. Computed by scanning the function's
     * parameter list for the first parameter whose type is the bare template
     * parameter name (or template-typed by it). Missing entries → 'unknown'
     * verdict at evaluation time.
     */
    readonly paramArgIndex: {
        readonly [paramName: string]: number;
    };
    /** Root constraint expression. When multiple constraints (multiple
     *  enable_if defaults, requires clause, etc.) are present they are
     *  implicitly conjoined under a top-level `and` node. */
    readonly expr: ConstraintExpr;
}
/**
 * Walk a `template_declaration` AST node and extract its constraint
 * payload. Caller is responsible for passing the OUTER `template_declaration`
 * — for class-member template functions, that means the enclosing
 * template_declaration of the class OR of the method, whichever
 * directly precedes the function definition.
 *
 * Returns `undefined` when the template_declaration declares no
 * constraints worth tracking (no enable_if default, no requires clause).
 * Returns a payload whose `expr.kind === 'unknown'` when constraints are
 * present but the extractor cannot model them — monotonicity guarantees
 * the filter keeps the candidate in that case.
 */
export declare function extractCppTemplateConstraints(templateDecl: SyntaxNode, funcDeclarator: SyntaxNode | null): CppConstraintPayload | undefined;
