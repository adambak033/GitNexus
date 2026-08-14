/**
 * Bounded retry helper with full-jitter exponential backoff.
 *
 * Runtime-agnostic: depends only on `setTimeout`, `Math.random`, and the
 * Promise machinery — no Node-only imports. Safe to consume from CLI,
 * server, or browser callers.
 *
 * Pattern reference: gitnexus/src/core/embeddings/http-client.ts. This
 * helper is the upgraded form: classification is caller-supplied (so
 * 4xx-vs-5xx-vs-timeout decisions live with the protocol that knows
 * them), backoff is exponential with full jitter, and an optional
 * `afterMs` lets callers honor `Retry-After` headers.
 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Compute the delay before the next retry attempt.
 *
 * - When the caller specifies `afterMs` (e.g., from `Retry-After`), use
 *   `min(afterMs, capDelayMs)` so a misbehaving server can't pin the
 *   client for an arbitrarily long wait.
 * - Otherwise compute full-jitter exponential backoff:
 *   `random() * min(cap, base * 2^attempt)`. Full jitter (rather than
 *   "equal jitter") avoids retry-storm thundering herd, per AWS
 *   guidance on backoff strategies.
 */
export function computeBackoffMs(attempt, baseDelayMs, capDelayMs, afterMs, random) {
    if (afterMs !== undefined) {
        return Math.min(Math.max(0, afterMs), capDelayMs);
    }
    const exponential = baseDelayMs * Math.pow(2, attempt);
    const upper = Math.min(capDelayMs, exponential);
    return Math.floor(random() * upper);
}
/**
 * Execute `fn` with bounded retries.
 *
 * The classification of "retryable" is the caller's responsibility — see
 * `resilient-fetch.ts` for the GitHub-dispatch-specific rules. This
 * helper is the mechanical retry loop only.
 */
export async function withRetry(fn, opts) {
    if (opts.maxAttempts < 1) {
        throw new Error(`withRetry: maxAttempts must be >= 1, got ${opts.maxAttempts}`);
    }
    const sleep = opts.sleep ?? defaultSleep;
    const random = opts.random ?? Math.random;
    let lastError;
    for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
        try {
            return await fn(attempt);
        }
        catch (err) {
            lastError = err;
            const decision = opts.isRetryable(err, attempt);
            if (!decision.retry)
                throw err;
            // Don't sleep after the final attempt.
            if (attempt + 1 >= opts.maxAttempts)
                break;
            const delayMs = computeBackoffMs(attempt, opts.baseDelayMs, opts.capDelayMs, decision.afterMs, random);
            if (delayMs > 0)
                await sleep(delayMs);
        }
    }
    throw lastError;
}
//# sourceMappingURL=retry.js.map