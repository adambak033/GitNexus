/**
 * Python import resolution config.
 * PEP 328 relative + proximity-based strategy, then standard fallback.
 */
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
/**
 * Python import resolution strategy — PEP 328 relative + proximity-based bare imports.
 * Returns null to continue chain for non-relative imports.
 * Absorbs unresolved relative imports (returns empty result to stop the chain).
 */
export declare const pythonImportStrategy: ImportResolverStrategy;
export declare const pythonImportConfig: ImportResolutionConfig;
