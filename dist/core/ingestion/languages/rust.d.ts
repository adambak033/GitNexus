/**
 * Rust Language Provider
 *
 * Assembles all Rust-specific ingestion capabilities into a single
 * LanguageProvider, following the Strategy pattern used by the pipeline.
 *
 * Key Rust traits:
 *   - mroStrategy: 'qualified-syntax' (Rust uses trait qualification, not MRO)
 */
export declare const rustProvider: import("../language-provider.js").LanguageProvider;
