import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { ParameterTypeClass } from '../../../../_shared/index.js';
export interface CppArityInfo {
    parameterCount?: number;
    requiredParameterCount?: number;
    parameterTypes?: string[];
    parameterTypeClasses?: ParameterTypeClass[];
}
/**
 * Compute declaration arity from a C++ function definition or declaration node.
 * Extends the C arity computation with support for:
 *   - optional_parameter_declaration (default parameters)
 *   - variadic_parameter_declaration / parameter packs
 *   - (void) explicit zero-parameter form
 */
export declare function computeCppDeclarationArity(node: SyntaxNode): CppArityInfo;
/**
 * Compute call-site arity from a call_expression node.
 */
export declare function computeCppCallArity(node: SyntaxNode): number;
/**
 * Normalize a C++ parameter type for overload disambiguation.
 * Maps common qualified/aliased types to their canonical short forms
 * so that `narrowOverloadCandidates` can match against literal-inferred
 * argument types (e.g. `inferCppLiteralType` returns `'string'` for
 * string literals, not `'std::string'`).
 *
 * This intentionally remains coarse and graph-ID-stable: cv-qualifiers,
 * reference markers, and pointer markers are stripped here. C++ callers
 * that need those distinctions should read `parameterTypeClasses`, which
 * is an additive sidecar and does not participate in overload node ID
 * hashing.
 */
export declare function normalizeCppParamType(raw: string): string;
export declare function classifyCppParameterType(rawType: string, declaratorText?: string, fullParameterText?: string): ParameterTypeClass;
