/**
 * HTTP Embedding Client
 *
 * Shared fetch+retry logic for OpenAI-compatible /v1/embeddings endpoints.
 * Imported by both the core embedder (batch) and MCP embedder (query).
 *
 * Network resilience is delegated to `resilientFetch` from
 * `gitnexus-shared` — bounded retries with exponential-backoff jitter,
 * `Retry-After` honored on 429, and an in-process circuit breaker that
 * fails fast on a flapping endpoint. Per-attempt timeout is enforced
 * via `AbortSignal.timeout` on the underlying fetch.
 */
export interface EmbeddingRequestOptions {
    signal?: AbortSignal;
}
/**
 * Whether HTTP embedding mode is active — i.e. both `GITNEXUS_EMBEDDING_URL` and
 * `GITNEXUS_EMBEDDING_MODEL` are set. A pure presence probe: it deliberately does
 * NOT call {@link readConfig}, so it never throws on a malformed
 * `GITNEXUS_EMBEDDING_DIMS`. This lets its ~13 call sites (analyze, doctor,
 * run-analyze, embedder, mcp) probe the mode without a defensive try/catch; the
 * DIMS value is validated where it is actually used (`readConfig` in
 * `httpEmbed`/`httpEmbedQuery`), surfacing a recognizable config error. See #2385.
 */
export declare const isHttpMode: () => boolean;
/**
 * Return the configured embedding dimensions for HTTP mode, or undefined
 * if HTTP mode is not active or no explicit dimensions are set.
 */
export declare const getHttpDimensions: () => number | undefined;
/**
 * Return the configured per-request HTTP timeout for HTTP mode, or undefined
 * when HTTP mode is not active.
 */
export declare const getHttpTimeoutMs: () => number | undefined;
/**
 * Return a safe representation of a URL for logs and error messages.
 * Strips query string (may contain tokens) and userinfo (may contain
 * credentials), keeping protocol + host + path. Exported so the CLI's
 * custom-endpoint confirmation can mask the same way.
 */
export declare const safeUrl: (url: string) => string;
/**
 * Error thrown by this module's HTTP embedding path (`httpEmbedBatch` /
 * `httpEmbed` / `httpEmbedQuery`) for any endpoint failure — a
 * connection/timeout/DNS error, an open circuit, a non-OK status, an
 * unparseable or wrong-shape response body, an empty response, or a dimension
 * mismatch.
 *
 * Carrying a distinct type (rather than a plain `Error`) lets the CLI tell a
 * *custom endpoint* failure apart from a HuggingFace *model download* failure
 * without matching message text: the two share the same underlying network
 * substrings (`fetch failed`, `ECONNREFUSED`, …), which is exactly why
 * `isNetworkFetchError` in `hf-env.ts` cannot tell them apart. Keying on the
 * type instead of the message is also locale-proof and survives message
 * rewording. The human-readable `.message` (built with `safeUrl` and the
 * underlying reason) is what the CLI surfaces to the user. See #2385.
 */
export declare class HttpEmbeddingError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/**
 * Embed texts via the HTTP backend, splitting into batches.
 * Reads config from env vars on every call.
 *
 * @param texts - Array of texts to embed
 * @returns Array of Float32Array embedding vectors
 */
export declare const httpEmbed: (texts: string[], requestOptions?: EmbeddingRequestOptions) => Promise<Float32Array[]>;
/**
 * Embed a single query text via the HTTP backend.
 * Convenience for MCP search where only one vector is needed.
 *
 * @param text - Query text to embed
 * @returns Embedding vector as number array
 */
export declare const httpEmbedQuery: (text: string, requestOptions?: EmbeddingRequestOptions) => Promise<number[]>;
