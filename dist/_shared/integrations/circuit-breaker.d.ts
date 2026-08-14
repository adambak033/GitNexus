/**
 * Per-process circuit breaker.
 *
 * Closed -> Open transition fires after `failureThreshold` consecutive
 * failures. While Open, `check` throws `CircuitOpenError` until
 * `cooldownMs` has elapsed since the breaker tripped. The first call
 * after the cooldown enters Half-Open and consumes the *probe permit*:
 * a recorded success returns to Closed; a recorded failure flips back
 * to Open with a fresh timestamp.
 *
 * Half-open admits exactly one in-flight probe at a time. Concurrent
 * callers attempting `check()` while a probe is outstanding receive
 * `CircuitOpenError` with `retryAfterMs = halfOpenRetryAfterMs` (default
 * 1000ms; configurable). This prevents the recovery-time thundering
 * herd that defeats the breaker's "fail fast" promise.
 *
 * Outcome reporting splits permit-release from state-resolution:
 *   - `recordSuccess` — releases the probe permit, resets the failure
 *     counter, transitions to Closed. Reserved for true 2xx/3xx outcomes.
 *   - `recordFailure` — releases the probe permit, increments the
 *     consecutive-failure counter, transitions to Open with a fresh
 *     `openedAt` (when called from Half-Open or when the threshold
 *     trips from Closed).
 *   - `recordNeutral` — releases the probe permit, BUT leaves state and
 *     counter untouched. Used for outcomes that are neither evidence of
 *     backend health nor evidence of backend failure (caller-driven
 *     cancellation, local timeout, terminal 4xx client errors). Critical
 *     design point: if `recordNeutral` did not release the permit, a
 *     single `TimeoutError` from per-attempt `AbortSignal.timeout` would
 *     route through `recordNeutral` and permanently park the breaker in
 *     half-open until process restart. Releasing the permit while leaving
 *     state half-open keeps the "neutral doesn't claim health" semantic
 *     without creating that wedge.
 *
 * Pairing invariant: every successful `check()` MUST be paired with
 * exactly one `record*()` on every code path including throws. Direct
 * consumers should wrap the protected operation in `try/finally`:
 *
 *   breaker.check();
 *   try {
 *     const result = await operation();
 *     breaker.recordSuccess();
 *     return result;
 *   } catch (err) {
 *     // classify err and call recordFailure / recordNeutral / etc.
 *     throw err;
 *   }
 *
 * `resilientFetch`'s catch-all on `fetchImpl` already satisfies this
 * for that consumer.
 *
 * Atomicity model: the half-open gate relies on JavaScript event-loop
 * single-threadedness within a synchronous `check()` body. There is no
 * `await` inside `check()`; concurrent callers serialize on microtask
 * order, and exactly one observes `probeInFlight === false`. Do not
 * introduce `await` inside `check()` without revisiting the gate. If
 * this code is ever ported to a runtime with shared-memory threads
 * (Node `worker_threads` with `SharedArrayBuffer`, Web Workers with
 * shared registries), the boolean must become an atomic CAS — Resilience4j
 * and Hystrix use atomic permits *because* they run in JVM thread pools.
 *
 * Runtime-agnostic: depends only on a `now()` clock and standard JS —
 * no Node-only imports. Tests inject `now` to advance the clock
 * deterministically without `vi.useFakeTimers()`.
 */
export declare class CircuitOpenError extends Error {
    readonly name = "CircuitOpenError";
    /** Approximate wait time before the breaker may transition to Half-Open
     *  (or before the in-flight probe is expected to resolve). */
    readonly retryAfterMs: number;
    constructor(retryAfterMs: number, key?: string);
}
export interface CircuitBreakerOptions {
    /** Consecutive failures required to trip Closed -> Open. */
    failureThreshold?: number;
    /** Milliseconds Open before the next call may probe (Half-Open). */
    cooldownMs?: number;
    /**
     * Milliseconds to suggest in `CircuitOpenError.retryAfterMs` when the
     * breaker is Half-Open with the probe permit consumed. Default 1000ms.
     * Consumers with long-running protected ops (LLM streaming, large
     * uploads) should raise this — the cooldown clock is no longer the
     * right answer because cooldown has elapsed. Returning 0 invites
     * retry storms; returning the full cooldown misleads about wait.
     */
    halfOpenRetryAfterMs?: number;
    /** Optional key for error messages and registry lookups. */
    key?: string;
    /** Clock override — defaults to `Date.now`. Tests inject deterministic time. */
    now?: () => number;
}
type State = 'closed' | 'open' | 'half-open';
export declare class CircuitBreaker {
    private readonly failureThreshold;
    private readonly cooldownMs;
    private readonly halfOpenRetryAfterMs;
    private readonly key;
    private readonly now;
    private state;
    private consecutiveFailures;
    private openedAt;
    /**
     * True between a successful `check()` and the next `record*()` call
     * during Half-Open. Gates concurrent callers from stampeding a still-
     * recovering dependency. Boolean rather than counter — single-permit
     * is the conservative end of the Hystrix/Resilience4j spectrum.
     */
    private probeInFlight;
    constructor(opts?: CircuitBreakerOptions);
    /**
     * Throw `CircuitOpenError` if the breaker won't admit this call.
     * Otherwise consume the half-open probe permit (if applicable) and
     * return so the caller can attempt the protected work.
     *
     * Three rejection paths:
     *   1. Open and still in cooldown → throws with `retryAfterMs` =
     *      remaining cooldown.
     *   2. Open with cooldown elapsed AND a probe is already in flight
     *      (race: another caller transitioned to half-open and grabbed
     *      the permit on a microtask before us) → throws with
     *      `halfOpenRetryAfterMs`.
     *   3. Half-Open with probe in flight → throws with `halfOpenRetryAfterMs`.
     *
     * **Pairing invariant**: every successful return from `check()` MUST
     * be paired with exactly one `recordSuccess` / `recordFailure` /
     * `recordNeutral` on every code path including thrown exceptions.
     * Failing to pair leaves the probe permit consumed forever and
     * wedges the breaker. See file-header JSDoc for the canonical
     * try/finally pattern.
     */
    check(): void;
    recordSuccess(): void;
    recordFailure(): void;
    /**
     * Releases the probe permit BUT leaves state and counter untouched.
     * Use when an attempt produced a response or error that should not
     * influence breaker health in either direction — caller-driven aborts,
     * local AbortSignal timeouts, terminal 4xx client errors.
     *
     * Why permit-release-without-state-resolution: if `recordNeutral` did
     * not clear `probeInFlight`, a single `TimeoutError` from per-attempt
     * `AbortSignal.timeout` (which routes through neutral classification)
     * would permanently park the breaker in half-open. Since timeouts are
     * an *expected* outcome under flaky-dependency conditions, the cited
     * "per-attempt timeout bounds the stuck state" mitigation would itself
     * be the trigger for a permanent wedge. Releasing the permit closes
     * that loop while keeping the "neutral doesn't claim dependency
     * health" semantic.
     *
     * Calling `recordSuccess` for these would erase legitimate prior
     * failure signal; calling `recordFailure` would trip the breaker for
     * outcomes the backend isn't responsible for.
     */
    recordNeutral(): void;
    /**
     * Pure read — no state mutation, no permit accounting. Returns the
     * *would-be* state at the current instant: 'half-open' if the breaker
     * is open with cooldown elapsed (regardless of whether a probe is in
     * flight), 'open' if open and still in cooldown, 'closed' otherwise.
     *
     * Inspection-only; safe to call from tests without consuming a probe
     * permit. The implicit Open -> Half-Open transition that mutates
     * `state` lives in `check()` only.
     */
    getState(): State;
    getConsecutiveFailures(): number;
    /** Inspection-only test accessor for the half-open probe permit. */
    isProbeInFlight(): boolean;
    /** Timestamp (ms since epoch) when the breaker last transitioned to Open,
     *  or `null` if it's currently Closed. Useful for computing remaining
     *  cooldown without consuming a probe permit via `check()`. */
    getOpenedAt(): number | null;
    /** Configured cooldown duration in milliseconds. */
    getCooldownMs(): number;
}
export declare function getBreaker(key: string, opts?: CircuitBreakerOptions): CircuitBreaker;
/**
 * Test-only: clear all registered breakers. Tests must call this in
 * `beforeEach` to prevent breaker state from leaking across test cases.
 */
export declare function __resetBreakerRegistry__(): void;
export {};
//# sourceMappingURL=circuit-breaker.d.ts.map