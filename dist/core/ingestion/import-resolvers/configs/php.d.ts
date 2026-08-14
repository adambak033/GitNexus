/**
 * PHP import resolution config.
 * PSR-4 strategy via composer.json — no standard fallback (PSR-4 includes its own suffix matching).
 */
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
/** PHP PSR-4 resolution strategy via composer.json autoload mappings. */
export declare const phpPsr4Strategy: ImportResolverStrategy;
export declare const phpImportConfig: ImportResolutionConfig;
