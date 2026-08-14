import type { VariableExtractionConfig } from '../../variable-types.js';
/**
 * Ruby variable extraction config.
 *
 * Ruby module-level constants use UPPER_CASE identifiers or start with
 * an uppercase letter. Ruby uses:
 * - assignment for variable declarations at module scope
 * - Constants: `MAX_SIZE = 100` or `Config = ...`
 * - Global variables: `$global = ...`
 */
export declare const rubyVariableConfig: VariableExtractionConfig;
