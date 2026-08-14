/**
 * Rewrites Dart 3.3 `extension type Name(Type value)` headers into ordinary
 * extension headers before tree-sitter sees the source. The vendored grammar
 * currently recovers these declarations through an ERROR subtree, while the
 * existing Dart ingestion path already handles `extension Name on Type`.
 */
export declare function preprocessDartExtensionTypes(sourceText: string): string;
