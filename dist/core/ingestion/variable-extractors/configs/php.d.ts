import type { VariableExtractionConfig } from '../../variable-types.js';
/**
 * PHP variable extraction config.
 *
 * PHP has const declarations at namespace/file scope and global variables:
 * - `const MAX_SIZE = 100;`
 * - `define('MAX_SIZE', 100);`
 * - `$variable = value;`
 *
 * tree-sitter-php uses:
 * - const_declaration at namespace/program scope
 * - expression_statement containing assignment_expression for variables
 */
export declare const phpVariableConfig: VariableExtractionConfig;
