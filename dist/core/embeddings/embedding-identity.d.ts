export interface EmbeddingIdentity {
    model: string;
    dimensions: number;
    provider: string;
}
/**
 * Identify the vector space strongly enough to resume without mixing providers.
 * The HTTP fingerprint excludes URL credentials and query parameters before
 * hashing, so metadata contains neither an endpoint nor a secret-derived hash.
 */
export declare function resolveEmbeddingIdentity(): EmbeddingIdentity;
