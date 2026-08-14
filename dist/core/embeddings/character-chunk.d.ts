/**
 * Character-based sliding window chunking (pure, no tree-sitter dependency)
 */
export interface Chunk {
    text: string;
    chunkIndex: number;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
}
export declare const characterChunk: (content: string, startLine: number, endLine: number, chunkSize?: number, overlap?: number) => Chunk[];
