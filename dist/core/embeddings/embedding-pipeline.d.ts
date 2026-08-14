/**
 * Embedding Pipeline Module
 *
 * Orchestrates the background embedding process:
 * 1. Query embeddable nodes from LadybugDB
 * 2. Generate text representations with enriched metadata
 * 3. Chunk long nodes, batch embed
 * 4. Update LadybugDB with chunk-aware embeddings
 * 5. Create vector index for semantic search
 */
import { type EmbeddingProgress, type EmbeddingConfig, type EmbeddableNode, type SemanticSearchResult } from './types.js';
import type { ExtensionInstallPolicy } from '../lbug/extension-loader.js';
/**
 * Resolve the extension-install policy for the embedding WRITE path (analyze).
 *
 * Generating embeddings is an explicit opt-in to a feature that requires the
 * VECTOR extension, so when the operator has NOT pinned a policy we default to
 * `auto` (one bounded, out-of-process INSTALL) — matching the documented
 * "auto = default for analyze" intent in extension-loader.ts. An explicit
 * GITNEXUS_LBUG_EXTENSION_INSTALL=load-only|never|auto always wins, so an
 * offline or locked-down operator is never silently forced onto the network
 * (the #1153 regression caused by hard-coding `auto` here). Read on every call
 * (not memoized) so test env stubbing works.
 */
export declare const resolveEmbeddingInstallPolicy: () => ExtensionInstallPolicy;
/**
 * Bump this when the embedding text template changes in a way that should
 * invalidate existing vectors, such as metadata/header shape changes,
 * structural container context changes, or preceding-context formatting rules.
 */
export declare const EMBEDDING_TEXT_VERSION = "v4";
/**
 * Compute a stable content fingerprint for an embeddable node.
 * Used to detect when the underlying text has changed so stale vectors
 * can be replaced (DELETE-then-INSERT, the Kuzu-sanctioned pattern for
 * vector-indexed rows).
 */
export declare const contentHashForNode: (node: EmbeddableNode, config?: Partial<EmbeddingConfig>) => string;
/**
 * Progress callback type
 */
export type EmbeddingProgressCallback = (progress: EmbeddingProgress) => void;
/**
 * Batch INSERT chunk-aware embeddings into CodeEmbedding table
 */
export declare const batchInsertEmbeddings: (executeWithReusedStatement: (cypher: string, paramsList: Array<Record<string, any>>) => Promise<void>, updates: Array<{
    nodeId: string;
    chunkIndex: number;
    startLine: number;
    endLine: number;
    embedding: number[];
    contentHash?: string;
}>) => Promise<void>;
/**
 * Create the vector index for semantic search (indexes the CodeEmbedding table).
 *
 * Keeps the embedding-specific extension-install policy gate here
 * (ensureVectorExtensionAvailable → resolveEmbeddingInstallPolicy, default
 * `auto` for the analyze write path), then delegates the actual
 * `CALL CREATE_VECTOR_INDEX(...)` to the adapter, which runs it through the
 * unprepared `conn.query()` path. It must NOT go through the injected
 * `executeQuery` (prepared `conn.prepare()`): LadybugDB cannot prepare that
 * procedure and fails with "We do not support prepare multiple statements" —
 * the silent degrade in #2114.
 *
 * Exported for run-analyze's wipe-and-restore seam (tri-review 4669518496
 * P1): a full-rebuild/escalated write wipes the DB files — index included —
 * and a preserve-only run restores embedding ROWS without ever reaching the
 * pipeline call sites below, so the orchestrator recreates the index through
 * this same policy-gated, warn-on-failure entry point. Consumed there via
 * dynamic import only (lazy-embeddings convention, #2370).
 */
export declare const buildVectorIndex: () => Promise<boolean>;
export interface EmbeddingPipelineResult {
    /** Nodes that finished the run with a COMPLETE set of embedding rows. */
    nodesProcessed: number;
    chunksProcessed: number;
    vectorIndexReady: boolean;
    semanticMode: 'vector-index' | 'exact-scan';
    /**
     * Nodes whose embeddings were dropped this run because at least one of their
     * chunks lost its sub-batch to a failing endpoint (#2790). Their rows were
     * deleted, so they now hold ZERO rows and the next incremental run re-embeds
     * them from scratch. Empty on a clean run.
     */
    failedNodeIds: string[];
}
export interface EmbeddingPipelineCheckpoint {
    nodesProcessed: number;
    totalNodes: number;
    chunksProcessed: number;
}
export interface EmbeddingPipelineCheckpointWindow extends EmbeddingPipelineCheckpoint {
    nodeIds: string[];
}
export interface EmbeddingPipelineOptions {
    signal?: AbortSignal;
    checkpointEveryNodes?: number;
    forceReembedNodeIds?: ReadonlySet<string>;
    onCheckpointWindowStart?: (window: EmbeddingPipelineCheckpointWindow) => Promise<void>;
    onCheckpoint?: (checkpoint: EmbeddingPipelineCheckpoint) => Promise<void>;
}
/**
 * Run the embedding pipeline
 *
 * @param executeQuery - Function to execute Cypher queries against LadybugDB
 * @param executeWithReusedStatement - Function to execute with reused prepared statement
 * @param onProgress - Callback for progress updates
 * @param config - Optional configuration override
 * @param skipNodeIds - Optional set of node IDs that already have embeddings (incremental mode)
 * @param existingEmbeddings - Optional map of nodeId → contentHash for incremental mode.
 *        Nodes whose hash matches are skipped; nodes with a changed hash are DELETE'd
 *        and re-embedded; nodes not in the map are embedded fresh.
 */
export declare const runEmbeddingPipeline: (executeQuery: (cypher: string) => Promise<any[]>, executeWithReusedStatement: (cypher: string, paramsList: Array<Record<string, any>>) => Promise<void>, onProgress: EmbeddingProgressCallback, config?: Partial<EmbeddingConfig>, skipNodeIds?: Set<string>, existingEmbeddings?: Map<string, string>, pipelineOptions?: EmbeddingPipelineOptions) => Promise<EmbeddingPipelineResult>;
/**
 * Perform semantic search using the vector index with chunk deduplication
 */
export declare const semanticSearch: (executeQuery: (cypher: string) => Promise<any[]>, query: string, k?: number, maxDistance?: number) => Promise<SemanticSearchResult[]>;
/**
 * Semantic search with graph expansion (flattened results)
 */
export declare const semanticSearchWithContext: (executeQuery: (cypher: string) => Promise<any[]>, query: string, k?: number, _hops?: number) => Promise<any[]>;
