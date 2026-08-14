/**
 * Python Language Provider
 *
 * Assembles all Python-specific ingestion capabilities into a single
 * LanguageProvider, following the Strategy pattern used by the pipeline.
 *
 * Key Python traits:
 *   - mroStrategy: 'c3' (Python C3 linearization for multiple inheritance)
 */
export declare const pythonProvider: import("../language-provider.js").LanguageProvider;
