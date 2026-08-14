/**
 * Framework Detection
 *
 * Detects frameworks from:
 * 1) file path patterns
 * 2) AST definition text (decorators/annotations/attributes)
 * and provides entry point multipliers for process scoring.
 *
 * DESIGN: Returns null for unknown frameworks, which causes a 1.0 multiplier
 * (no bonus, no penalty) - same behavior as before this feature.
 */
import { SupportedLanguages } from '../../_shared/index.js';
export interface FrameworkHint {
    framework: string;
    entryPointMultiplier: number;
    reason: string;
}
/**
 * Detect framework from file path patterns
 *
 * This provides entry point multipliers based on well-known framework conventions.
 * Returns null if no framework pattern is detected (falls back to 1.0 multiplier).
 */
export declare function detectFrameworkFromPath(filePath: string): FrameworkHint | null;
/**
 * Detect framework entry points from AST definition text (decorators/annotations/attributes).
 * Returns null if no known pattern is found.
 * Note: callers should slice definitionText to ~300 chars since annotations appear at the start.
 */
export declare function detectFrameworkFromAST(language: SupportedLanguages, definitionText: string): FrameworkHint | null;
