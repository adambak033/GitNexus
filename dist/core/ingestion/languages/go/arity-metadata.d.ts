import type { SyntaxNode } from '../../utils/ast-helpers.js';
export interface GoArityMetadata {
    readonly parameterCount?: number;
    readonly requiredParameterCount?: number;
    readonly parameterTypes?: readonly string[];
    readonly returnType?: string;
}
export declare function computeGoDeclarationArity(node: SyntaxNode): GoArityMetadata;
export declare function computeGoCallArity(callNode: SyntaxNode): number;
