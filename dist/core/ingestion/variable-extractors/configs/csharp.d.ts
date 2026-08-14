import type { VariableExtractionConfig } from '../../variable-types.js';
/**
 * C# variable extraction config.
 *
 * C# does not have true top-level variables (pre-C# 9). In C# 9+ top-level
 * statements, local_declaration_statement can appear at program scope.
 * Class-scoped fields are handled by the field extractor.
 */
export declare const csharpVariableConfig: VariableExtractionConfig;
