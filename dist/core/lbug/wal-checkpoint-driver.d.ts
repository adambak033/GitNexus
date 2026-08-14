/**
 * Manual WAL checkpoint driver with bounded retry (#1741 follow-up).
 *
 * Background
 * ----------
 * LadybugDB's native auto-checkpoint runs from inside the C++ engine on a
 * background path that has no JS-side hook for mid-write rotation. When
 * the rename of `<db>.wal` → `<db>.wal.checkpoint` races a transient file
 * lock (Windows Defender, AV scanner, NTFS shadow copy) the engine raises
 * a `Runtime exception: IO exception: Error renaming file …` that aborts
 * the in-flight write. There is no engine-level retry.
 *
 * The auto-checkpoint cannot be made retryable from JS, but a *manual*
 * `CHECKPOINT` query that the JS layer issues itself CAN be wrapped in a
 * bounded retry. By draining the WAL on a tight cadence — more often than
 * the native threshold — the auto-checkpoint almost never has work left
 * to do, so the un-retriable native rename race is moved into the
 * JS-controlled path where this module's retry absorbs it.
 *
 * Design contract
 * ---------------
 * - `autoCheckpoint` stays on (maintainer requirement). This driver is
 *   additive: it preempts the native checkpoint, it does not replace it.
 * - The driver runs ONLY during analyze (callers opt-in explicitly). MCP
 *   and other long-lived flows continue to rely on the close-time
 *   CHECKPOINT in `safeClose`.
 * - Opt-out is via `GITNEXUS_WAL_MANUAL_CHECKPOINT=0`. Default is on.
 * - Retries only fire on `isLbugCheckpointIoError` — every other error
 *   surfaces immediately. The retry budget is small (3 attempts) with
 *   jittered backoff so a chronic rename failure escalates fast.
 * - Retry attempts log at `debug`; only the final, exhausted failure
 *   surfaces to the caller (and is logged at `warn` here for operators).
 */
/**
 * Run a single CHECKPOINT with bounded retry on
 * `isLbugCheckpointIoError`. Returns the number of attempts actually
 * spent (1-`CHECKPOINT_RETRY_ATTEMPTS`) on success, or rethrows the last
 * checkpoint error after exhausting the budget. Non-checkpoint errors
 * (e.g. WAL corruption, lock-busy) propagate immediately on the first
 * attempt — those are not what this retry is designed to absorb.
 *
 * The split from `flushWAL` is deliberate: `flushWAL` is the swallow-and-
 * log helper used by `safeClose` and the server's best-effort flush,
 * which by contract cannot fail the surrounding operation. The manual
 * driver MUST observe failures to decide whether to retry, and that is
 * the role of `tryFlushWAL`.
 *
 * Exported for direct unit testing — production callers use
 * {@link startWalCheckpointDriver} or {@link checkpointOnce}.
 */
export declare const runCheckpointWithRetry: (options?: {
    /** Override the sleep implementation for tests. */
    sleepFn?: (ms: number) => Promise<void>;
    /** Override the CHECKPOINT call for tests. */
    checkpointFn?: () => Promise<boolean>;
    /** Override the jitter source for tests. Returns a value in [0, 1). */
    randomFn?: () => number;
}) => Promise<{
    attempts: number;
    flushed: boolean;
}>;
/**
 * Single-shot manual checkpoint. Use this when the caller drives the
 * cadence itself (e.g. a phase boundary in `runFullAnalysis`).
 *
 * Honors the `GITNEXUS_WAL_MANUAL_CHECKPOINT=0` opt-out so operators can
 * disable the manual path if it ever interacts badly with a future
 * Ladybug release.
 */
export declare const checkpointOnce: () => Promise<void>;
/**
 * Start a periodic manual checkpoint driver. The returned handle has a
 * `stop()` method that resolves once the in-flight checkpoint (if any)
 * settles, so callers can `await driver.stop()` before close-time
 * `safeClose` and avoid racing the final flush.
 *
 * The first checkpoint fires after `periodMs` (not immediately) so a
 * cold analyze does not pay a CHECKPOINT round trip before any writes
 * have happened.
 */
export interface WalCheckpointDriver {
    /** Stop the driver and await any in-flight checkpoint. Idempotent. */
    stop(): Promise<void>;
}
export declare const startWalCheckpointDriver: (options?: {
    periodMs?: number;
}) => WalCheckpointDriver;
/**
 * Reading `GITNEXUS_WAL_MANUAL_CHECKPOINT` at every call site (rather
 * than caching at module load) keeps `analyzeCommand` env restoration
 * honest: tests that toggle the flag between invocations see the live
 * value, matching the `ANALYZE_CLI_ENV_KEYS` snapshot/restore contract
 * in `analyze.ts`.
 *
 * Accepted opt-out values: '0', 'false', 'off', 'no' (case-insensitive).
 * Anything else — including undefined — leaves the driver enabled.
 */
export declare const isManualCheckpointEnabled: () => boolean;
