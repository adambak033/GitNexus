/**
 * Extract Python arity metadata from a `function_definition` tree-sitter
 * node — parameter count, required count, and (where present) a type
 * list that the existing `pythonArityCompatibility` hook reads.
 *
 * Mirrors the legacy `buildMethodProps` conversion so scope-extracted
 * defs carry the same arity semantics as the parse-worker path:
 *   - `self` / `cls` are stripped (consumed by `extractPythonParameters`).
 *   - Defaulted params contribute to `optionalCount`, flipping
 *     `requiredParameterCount = total − optionalCount`.
 *   - Variadic (`*args` / `**kwargs`) collapses `parameterCount` to
 *     `undefined`, which `pythonArityCompatibility` then treats as
 *     `'unknown'` — keeping the candidate in the registry's lookup set.
 *   - `parameterTypes` is populated only with real type text, matching
 *     legacy behavior.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
interface PythonArityMetadata {
    readonly parameterCount: number | undefined;
    readonly requiredParameterCount: number | undefined;
    readonly parameterTypes: readonly string[] | undefined;
    readonly parameterNames: readonly string[];
}
export declare function computePythonArityMetadata(fnNode: SyntaxNode): PythonArityMetadata;
export {};
