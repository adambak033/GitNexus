/**
 * Text Generator Module
 *
 * Generates compact, description-forward embedding text from code nodes.
 * Supports chunkable labels (Function/Method with AST chunking),
 * Class-specific structural text, and short-node direct embed.
 *
 * Method/field names for Class nodes are extracted by the ingestion
 * pipeline's AST extractors and passed via node.methodNames/node.fieldNames.
 */
import type { EmbeddableNode, EmbeddingConfig } from './types.js';
/**
 * Truncate description to max length at sentence/word boundary
 */
declare const truncateDescription: (text: string, maxLength: number) => string;
/**
 * Extract class/interface/struct declaration lines, skipping method bodies.
 * - Brace-based languages: detects method signatures (lines with `(` and `{`)
 *   and skips until depth returns to class body level.
 * - Non-brace languages (Python/Ruby): returns empty string (patterns handle extraction).
 */
export declare const extractDeclarationOnly: (content: string) => string;
/**
 * Generate embedding text for any embeddable node
 * Dispatches to the appropriate generator based on node label
 */
export declare const generateEmbeddingText: (node: EmbeddableNode, codeBody: string, config?: Partial<EmbeddingConfig>, chunkIndex?: number, prevTail?: string) => string;
/**
 * Export truncation helper for testing
 */
export { truncateDescription };
