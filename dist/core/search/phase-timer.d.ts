/**
 * Per-phase wall-clock timing for the search pipeline and similar
 * multi-stage flows. Designed to be called from query() with minimal
 * ceremony and negligible overhead (< 0.1 ms per phase recorded).
 *
 * ### Sequential usage
 *
 * ```ts
 * const t = new PhaseTimer();
 * t.start('bm25'); await bm25Search(...); t.stop();
 * t.start('merge'); doMerge(); t.stop();
 * const phases = t.summary(); // { bm25: 42, merge: 3 }
 * ```
 *
 * ### Concurrent usage (Promise.all)
 *
 * `start`/`stop` assume a single active phase at a time, which is wrong
 * for concurrent work inside `Promise.all` — the second `start` would
 * auto-stop the first and only one of the two would get timed. Use
 * {@link PhaseTimer.time} to wrap each concurrent promise instead:
 *
 * ```ts
 * const [a, b] = await Promise.all([
 *   t.time('bm25', bm25Search(...)),
 *   t.time('vector', semanticSearch(...)),
 * ]);
 * ```
 *
 * ### Pre-measured durations
 *
 * ```ts
 * t.mark('inherited', 12.5);
 * ```
 */
export declare class PhaseTimer {
    private phases;
    private current;
    private t0;
    /** Start a new phase. Implicitly stops the previous one, if any. */
    start(phase: string): void;
    /** Stop the current phase. No-op if no phase is active. */
    stop(): void;
    /**
     * Record a pre-measured duration without touching the active phase.
     * Use for concurrent operations inside `Promise.all` where
     * `start`/`stop` would step on each other, or for durations imported
     * from sub-systems. Additive across repeated calls with the same
     * phase name. Ignores negative / non-finite inputs.
     */
    mark(phase: string, durationMs: number): void;
    /**
     * Wrap a promise with automatic timing. Records wall time via
     * {@link PhaseTimer.mark} regardless of which other phases are
     * active — safe to use inside `Promise.all`.
     */
    time<T>(phase: string, promise: Promise<T>): Promise<T>;
    /**
     * Snapshot of accumulated durations rounded to 0.1 ms. Stops the
     * current phase if one is still running.
     */
    summary(): Record<string, number>;
    /**
     * Sum of every recorded phase duration.
     *
     * Note: for phases recorded via {@link PhaseTimer.time} or
     * {@link PhaseTimer.mark} this is the *sum*, not the wall time —
     * concurrent work overlaps and the sum can exceed the end-to-end
     * wall time. Record wall time separately with `mark('wall', …)` if
     * that distinction matters.
     */
    totalMs(): number;
}
