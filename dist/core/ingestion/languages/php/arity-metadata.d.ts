/**
 * Extract PHP arity metadata from a method-like tree-sitter node —
 * `method_declaration` or `function_definition`.
 *
 * Reuses `phpMethodConfig.extractParameters` so scope-extracted defs
 * carry the same arity semantics as the legacy parse-worker path:
 *   - `variadic_parameter` (`...$args`) collapses `parameterCount` to
 *     `undefined`, which `phpArityCompatibility` then treats as
 *     "max unknown" — the candidate stays eligible at `argCount >= required`.
 *   - Defaulted parameters (`= expr`) contribute to `optionalCount`;
 *     `requiredParameterCount = total − optionalCount − (variadic ? 1 : 0)`.
 *     The variadic slot itself accepts zero args so it is subtracted from
 *     the required count — `f(int $a, ...$rest)` requires exactly 1 arg,
 *     not 2, and `f(...$rest)` requires 0.
 *   - `property_promotion_parameter` (constructor-promoted) is counted
 *     the same as `simple_parameter` since both consume an argument slot.
 *   - `parameterTypes` collects declared type names; a literal `'...'`
 *     marker is appended for variadic methods so `phpArityCompatibility`
 *     can detect them without re-reading the AST.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
interface PhpArityMetadata {
    readonly parameterCount: number | undefined;
    readonly requiredParameterCount: number | undefined;
    readonly parameterTypes: readonly string[] | undefined;
}
export declare function computePhpArityMetadata(fnNode: SyntaxNode): PhpArityMetadata;
export {};
