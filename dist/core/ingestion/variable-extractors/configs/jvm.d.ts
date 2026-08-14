import type { VariableExtractionConfig } from '../../variable-types.js';
/**
 * Java variable extraction config.
 *
 * Java does not have true module-level variables — all declarations are
 * class-scoped. However, `static final` fields at class scope act like
 * constants. These are already handled by the field extractor. This config
 * covers any rare local_variable_declaration captures at file scope
 * (e.g., in scripts or top-level code blocks in JShell).
 */
export declare const javaVariableConfig: VariableExtractionConfig;
/**
 * Kotlin variable extraction config.
 *
 * Kotlin has true top-level val/var declarations outside classes.
 * tree-sitter-kotlin uses 'property_declaration' for both.
 */
export declare const kotlinVariableConfig: VariableExtractionConfig;
