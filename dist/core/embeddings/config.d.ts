import { type EmbeddingConfig } from './types.js';
export declare const DEFAULT_VECTOR_MAX_DISTANCE = 0.5;
export declare const DEFAULT_MCP_VECTOR_MAX_DISTANCE = 0.6;
/**
 * Cosine distance over normalized embeddings is bounded to [0, 2], so any threshold
 * above this accepts every row and silently disables the relevance filter. Values
 * over the ceiling are clamped to it rather than passed through.
 */
export declare const VECTOR_MAX_DISTANCE_CEILING = 2;
/**
 * Resolve the effective max accepted vector/semantic cosine distance.
 * Reads `GITNEXUS_VECTOR_MAX_DISTANCE`. Unset/empty/whitespace → silent fallback.
 * Invalid (non-numeric, <= 0, non-finite) → fallback plus a one-time warning.
 * Values above the cosine ceiling (2) are clamped to it with a one-time warning.
 */
export declare const getVectorMaxDistance: (fallback?: number) => number;
export declare const resolveEmbeddingConfig: (overrides?: Partial<EmbeddingConfig>) => EmbeddingConfig;
