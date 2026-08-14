import type { SyntaxNode } from '../../utils/ast-helpers.js';
export interface KotlinArityMetadata {
    readonly parameterCount: number | undefined;
    readonly requiredParameterCount: number | undefined;
    readonly parameterTypes: readonly string[] | undefined;
}
export declare function computeKotlinArityMetadata(fnNode: SyntaxNode): KotlinArityMetadata;
