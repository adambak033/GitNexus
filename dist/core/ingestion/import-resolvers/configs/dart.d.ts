/**
 * Dart import resolution config.
 * SDK/package strategy first, then relative import strategy (with ./ prepending).
 */
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
/**
 * Dart SDK and package: import strategy.
 * Absorbs dart: SDK imports and external packages (returns empty result to stop chain).
 * Returns null for relative imports to let the next strategy handle them.
 */
export declare const dartPackageStrategy: ImportResolverStrategy;
/**
 * Dart relative import strategy — prepends "./" for bare relative paths,
 * then delegates to standard resolution.
 */
export declare const dartRelativeStrategy: ImportResolverStrategy;
export declare const dartImportConfig: ImportResolutionConfig;
