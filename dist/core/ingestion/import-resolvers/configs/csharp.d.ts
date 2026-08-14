/**
 * C# import resolution config.
 * Namespace-based strategy via .csproj configs, then standard fallback.
 */
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
/** C# namespace-based resolution strategy via .csproj configs. */
export declare const csharpNamespaceStrategy: ImportResolverStrategy;
export declare const csharpImportConfig: ImportResolutionConfig;
