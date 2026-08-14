/**
 * Rust import resolution config.
 * Rust module strategy (grouped imports, crate/super/self paths), then standard fallback.
 */
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
/** Rust module resolution strategy — handles grouped imports and crate/super/self paths. */
export declare const rustModuleStrategy: ImportResolverStrategy;
export declare const rustImportConfig: ImportResolutionConfig;
