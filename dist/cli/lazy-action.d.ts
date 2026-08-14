/**
 * Creates a lazy-loaded CLI action that defers module import until invocation.
 * The generic constraints ensure the export name is a valid key of the module
 * at compile time — catching typos when used with concrete module imports.
 */
export declare function createLazyAction<TModule extends Record<string, unknown>, TKey extends string & keyof TModule>(loader: () => Promise<TModule>, exportName: TKey): (...args: unknown[]) => Promise<void>;
export declare function createLbugLazyAction<TModule extends Record<string, unknown>, TKey extends string & keyof TModule>(loader: () => Promise<TModule>, exportName: TKey): (...args: unknown[]) => Promise<void>;
/**
 * Analyze-specific lazy action. Unlike the generic LadybugDB wrapper, this
 * captures the complete analyzer receipt before probing/loading native code or
 * evaluating the analyzer module graph. The target export receives that start
 * receipt as its first argument and threads it to runFullAnalysis.
 */
export declare function createAnalyzerLbugLazyAction<TModule extends Record<string, unknown>, TKey extends string & keyof TModule>(identityLoader: () => Promise<Pick<typeof import('../core/analyzer-identity.js'), 'captureAnalyzerIdentityBeforeLoad'>>, loader: () => Promise<TModule>, exportName: TKey, analyzerModuleUrl: string): (...args: unknown[]) => Promise<void>;
