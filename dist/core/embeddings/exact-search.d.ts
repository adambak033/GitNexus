export interface ExactEmbeddingRow {
    nodeId: string;
    chunkIndex: number;
    startLine: number;
    endLine: number;
    embedding: readonly number[];
}
export interface ExactSearchChunk {
    nodeId: string;
    chunkIndex: number;
    startLine: number;
    endLine: number;
    distance: number;
}
export declare const rankExactEmbeddingRows: (rows: readonly ExactEmbeddingRow[], queryEmbedding: readonly number[], limit: number, maxDistance: number) => ExactSearchChunk[];
