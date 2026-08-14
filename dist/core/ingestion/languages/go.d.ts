/**
 * Go Language Provider
 *
 * Assembles all Go-specific ingestion capabilities into a single
 * LanguageProvider, following the Strategy pattern used by the pipeline.
 *
 * Key Go traits:
 *   - callRouter: present (Go method calls may need routing)
 */
export declare const goProvider: import("../language-provider.js").LanguageProvider;
