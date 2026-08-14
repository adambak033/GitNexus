/**
 * Java / Kotlin import resolution configs.
 * JVM-specific wildcard/member strategy, then standard fallback.
 */
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
/** Java JVM resolution strategy — wildcard and member import resolution. */
export declare const javaJvmStrategy: ImportResolverStrategy;
/**
 * Kotlin JVM resolution strategy — wildcard/member with Java-interop + top-level function imports.
 */
export declare const kotlinJvmStrategy: ImportResolverStrategy;
export declare const javaImportConfig: ImportResolutionConfig;
export declare const kotlinImportConfig: ImportResolutionConfig;
