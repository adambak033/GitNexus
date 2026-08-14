/**
 * Wall-clock logging for the post-chunk deferred resolution band
 * (imports → heritage → heritage map → legacy call resolution).
 *
 * Enabled when either:
 *   - `GITNEXUS_VERBOSE=1` / `gitnexus analyze -v` (primary path for #1741), or
 *   - `GITNEXUS_PROFILE_DEFERRED=1` (force on without full verbose ingestion noise)
 *
 * Issue #1741: large Java/Kotlin repos appear stuck at "Resolving calls"
 * because the UI progress bar updates every 100 files and intermediate
 * stages emit little to the log.
 */
/** Min wall-clock gap between always-on slow-file warnings (throttle). */
export declare const ALWAYS_ON_SLOW_FILE_WARN_THROTTLE_MS = 30000;
/** True when deferred-stage timing / progress logs should emit. */
export declare const isDeferredResolutionProfileEnabled: () => boolean;
/** Log a call-resolution progress line every N files (finer when verbose). */
export declare const deferredCallLogEveryN: () => number;
/** Per-file call-resolution log threshold (ms). Lower default when verbose. */
export declare const deferredCallFileSlowMs: () => number;
/**
 * Always-on per-file slow threshold (ms) for the `logger.warn` watchdog in
 * `processCallsFromExtracted`. Unlike {@link deferredCallFileSlowMs} this is
 * NOT gated on verbose/profile — it fires on every run. `0` (or a negative /
 * non-finite override) disables the watchdog entirely. Override via
 * `GITNEXUS_SLOW_FILE_WARN_MS`.
 */
export declare const alwaysOnSlowFileWarnMs: () => number;
export declare const profileNow: () => bigint;
export declare const profileElapsedMs: (start: bigint) => number;
/**
 * Number of `logDeferredProfile` calls whose underlying `logger.info` threw.
 * Surfaced in the deferred-band done-summary when greater than zero.
 */
export declare const getDeferredProfileDroppedCount: () => number;
/**
 * Reset the dropped-line counter. Call from test `afterEach` to keep the
 * module-private state from leaking across tests. Also used inside
 * `processCallsFromExtracted` at function entry so each analyze run gets
 * a fresh count rather than accumulating across the process lifetime.
 */
export declare const resetDeferredProfileDroppedCount: () => void;
export declare const logDeferredProfile: (message: string) => void;
/**
 * Capture a monotonic timestamp when profiling is enabled; otherwise return null.
 * Pair with `endTimer` so the type system narrows correctly — using `null` instead
 * of a `0n` sentinel makes "profiling disabled" structurally distinct from
 * "zero elapsed time" and lets TypeScript catch missing guards.
 */
export declare const startTimer: (enabled: boolean) => bigint | null;
/**
 * Emit a `[deferred-profile]` log line for a captured timer. No-op when the
 * timer is `null` (profiling was disabled at capture time). The formatter
 * receives elapsed ms so the call sites stay readable.
 *
 * The format callback runs inside a try/catch so a throwing formatter
 * (custom toString, JSON.stringify on a circular object) cannot abort the
 * deferred resolution band — observability code must never escalate to a
 * load-bearing failure. On catch we emit a single `formatter error: …`
 * line via logDeferredProfile and return; the caller's stage continues
 * as if profiling had no-op'd for this timer. DoD §2.8 ("no silent
 * catches that swallow diagnostics") is satisfied by surfacing the
 * failure message rather than dropping it.
 */
export declare const endTimer: (start: bigint | null, format: (elapsedMs: number) => string) => void;
