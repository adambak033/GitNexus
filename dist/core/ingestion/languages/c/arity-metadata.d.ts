import type { SyntaxNode } from '../../utils/ast-helpers.js';
export interface CArityInfo {
    parameterCount?: number;
    requiredParameterCount?: number;
    parameterTypes?: string[];
}
/**
 * Compute declaration arity from a C function definition or declaration node.
 */
export declare function computeCDeclarationArity(node: SyntaxNode): CArityInfo;
/**
 * Compute call-site arity from a call_expression node.
 */
export declare function computeCCallArity(node: SyntaxNode): number;
