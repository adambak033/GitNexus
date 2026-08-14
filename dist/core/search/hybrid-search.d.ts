/**
 * Hybrid Search with Reciprocal Rank Fusion (RRF)
 *
 * Combines BM25 (keyword) and semantic (embedding) search results.
 * Uses RRF to merge rankings without needing score normalization.
 *
 * This is the same approach used by Elasticsearch, Pinecone, and other
 * production search systems.
 */
import { type BM25SearchResult } from './bm25-index.js';
import type { SemanticSearchResult } from '../embeddings/types.js';
export interface HybridSearchResult {
    filePath: string;
    score: number;
    rank: number;
    sources: ('bm25' | 'semantic')[];
    nodeId?: string;
    name?: string;
    label?: string;
    startLine?: number;
    endLine?: number;
    bm25Score?: number;
    semanticScore?: number;
}
/**
 * Perform hybrid search combining BM25 and semantic results
 *
 * @param bm25Results - Results from BM25 keyword search
 * @param semanticResults - Results from semantic/embedding search
 * @param limit - Maximum results to return
 * @returns Merged and re-ranked results
 */
export declare const mergeWithRRF: (bm25Results: BM25SearchResult[], semanticResults: SemanticSearchResult[], limit?: number) => HybridSearchResult[];
/**
 * Check if hybrid search is available.
 * FTS indexes may be missing on read-only MCP connections (see #1403);
 * callers should inspect `ftsAvailable` from searchFTSFromLbug for
 * per-query availability. This helper is a coarse gate only.
 */
export declare const isHybridSearchReady: () => boolean;
/**
 * Format hybrid results for LLM consumption
 */
export declare const formatHybridResults: (results: HybridSearchResult[]) => string;
/**
 * Execute BM25 + semantic search and merge with RRF.
 * Uses LadybugDB FTS for always-fresh BM25 results (no cached data).
 * The semanticSearch function is injected to keep this module environment-agnostic.
 *
 * When FTS is unavailable (e.g. read-only MCP connection, missing indexes),
 * falls back to semantic-only results instead of crashing (#1489).
 */
export declare const hybridSearch: (query: string, limit: number, executeQuery: (cypher: string) => Promise<any[]>, semanticSearch: (executeQuery: (cypher: string) => Promise<any[]>, query: string, k?: number) => Promise<SemanticSearchResult[]>) => Promise<HybridSearchResult[]>;
