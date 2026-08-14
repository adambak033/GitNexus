/**
 * Go import resolution config.
 * Go-specific package strategy (go.mod), then standard fallback.
 */
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
/** Go-specific package resolution strategy — resolves go.mod-based package imports. */
export declare const goPackageStrategy: ImportResolverStrategy;
export declare const goImportConfig: ImportResolutionConfig;
