/**
 * Shared bounded "checkpoint, then exit" cleanup for interrupt/cancel signals
 * (#2264). The CLI SIGINT handler and the forked worker's SIGTERM handler both
 * need to: CHECKPOINT the WAL for durability (skipping the native close — see
 * closeLbugBeforeExit), but NOT hang behind an in-flight COPY that holds the
 * connection lock, and then exit. Bounding the CHECKPOINT with a short timeout
 * keeps a single Ctrl-C / cancel responsive; the WAL replays on the next analyze.
 */
import { closeLbugBeforeExit } from './lbug-adapter.js';
/** Default cap so a CHECKPOINT queued behind a long COPY can't wedge the signal. */
export const DEFAULT_EXIT_CLEANUP_TIMEOUT_MS = 2000;
/**
 * Best-effort CHECKPOINT bounded by a timeout, then exit. Never rejects — the
 * exit always fires (in `finally`) even if the CHECKPOINT throws. Fire-and-forget
 * from a signal handler (`void boundedCheckpointBeforeExit({...})`).
 */
export async function boundedCheckpointBeforeExit(opts) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXIT_CLEANUP_TIMEOUT_MS;
    const checkpoint = opts.checkpoint ?? closeLbugBeforeExit;
    const exit = opts.exit ?? ((code) => process.exit(code));
    let timer;
    try {
        await Promise.race([
            checkpoint().catch((err) => opts.onFlushError?.(err)),
            new Promise((resolve) => {
                timer = setTimeout(resolve, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        await opts.beforeExit?.();
        exit(opts.exitCode);
    }
}
