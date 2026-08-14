/**
 * Extract Java arity metadata from a method-like tree-sitter node —
 * `method_declaration` or `constructor_declaration`.
 *
 * Reuses `javaMethodConfig.extractParameters` so scope-extracted defs
 * carry the same arity semantics as the legacy parse-worker path:
 *   - varargs (`...`) collapses `parameterCount` to `undefined`
 *   - `parameterTypes` collects declared type names; a literal
 *     `'varargs'` marker is appended for variadic methods so
 *     `javaArityCompatibility` can detect them.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
export interface JavaArityMetadata {
    readonly parameterCount: number | undefined;
    readonly requiredParameterCount: number | undefined;
    readonly parameterTypes: readonly string[] | undefined;
}
export declare function computeJavaArityMetadata(fnNode: SyntaxNode): JavaArityMetadata;
