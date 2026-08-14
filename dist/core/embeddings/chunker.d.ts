/**
 * Chunker Module
 *
 * Splits code nodes into chunks for embedding.
 * - Function/Method: AST-aware chunking by statement boundaries
 * - Other types: character-based sliding window fallback
 * - Short content (≤ chunkSize): no chunking
 */
export { type Chunk, characterChunk } from './character-chunk.js';
import type { Chunk } from './character-chunk.js';
/**
 * Main chunkNode function: dispatches by label
 */
export declare const chunkNode: (label: string, content: string, filePath: string, startLine: number, endLine: number, chunkSize?: number, overlap?: number) => Promise<Chunk[]>;
