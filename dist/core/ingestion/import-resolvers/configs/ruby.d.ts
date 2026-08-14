/**
 * Ruby import resolution config.
 * Require/require_relative suffix matching — no standard fallback.
 */
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
/** Ruby require/require_relative resolution strategy. */
export declare const rubyRequireStrategy: ImportResolverStrategy;
export declare const rubyImportConfig: ImportResolutionConfig;
