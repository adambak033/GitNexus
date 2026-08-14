/**
 * Shared AST utilities for the embedding pipeline.
 * Centralizes parser caching and tree-sitter node lookups
 * used by both chunker.ts and structural-extractor.ts.
 */
/**
 * Ensure parser is initialized and language is loaded, then parse content.
 * Returns null if language is unavailable or parsing fails.
 */
export declare const ensureAndParse: (content: string, filePath: string) => Promise<any | null>;
/**
 * Find the first function/method-like declaration in a snippet AST.
 * Used by the chunker when parsing node.content where absolute line
 * numbers don't apply.
 */
export declare const findFunctionNode: (root: any) => any | null;
/**
 * Find the first class/struct/interface/enum-like declaration in an AST.
 * Used when parsing node.content (a snippet, not a full file) where
 * absolute line numbers don't apply.
 */
export declare const findDeclarationNode: (root: any) => any | null;
