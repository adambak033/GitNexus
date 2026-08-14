/**
 * Extract C# arity metadata from a method-like tree-sitter node —
 * `method_declaration`, `constructor_declaration`, `destructor_declaration`,
 * `operator_declaration`, `conversion_operator_declaration`, or
 * `local_function_statement`.
 *
 * Reuses `csharpMethodConfig.extractParameters` so scope-extracted defs
 * carry the same arity semantics as the legacy parse-worker path:
 *   - `params` variadic collapses `parameterCount` to `undefined`,
 *     which `csharpArityCompatibility` then treats as "max unknown" —
 *     the candidate stays eligible at `argCount >= required`.
 *   - Defaulted parameters (`= expr`) contribute to `optionalCount`;
 *     `requiredParameterCount = total − optionalCount`.
 *   - `parameterTypes` collects declared type names (with `ref`/`out`/
 *     `in` prefix) for overload narrowing; a literal `'params'` marker
 *     is appended for variadic methods so `csharpArityCompatibility`
 *     can detect them without re-reading the AST.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
interface CsharpArityMetadata {
    readonly parameterCount: number | undefined;
    readonly requiredParameterCount: number | undefined;
    readonly parameterTypes: readonly string[] | undefined;
}
export declare function computeCsharpArityMetadata(fnNode: SyntaxNode): CsharpArityMetadata;
export {};
