/** Default cap so a CHECKPOINT queued behind a long COPY can't wedge the signal. */
export declare const DEFAULT_EXIT_CLEANUP_TIMEOUT_MS = 2000;
export interface BoundedCheckpointExitOptions {
    /** Exit code to terminate with (130 for SIGINT, 0 for a worker SIGTERM). */
    exitCode: number;
    /** Cap on the CHECKPOINT; defaults to {@link DEFAULT_EXIT_CLEANUP_TIMEOUT_MS}. */
    timeoutMs?: number;
    /** Report a CHECKPOINT failure (e.g. over IPC) rather than swallowing it. */
    onFlushError?: (err: unknown) => void;
    /** Run just before exit (e.g. flush the logger synchronously). */
    beforeExit?: () => void | Promise<void>;
}
/**
 * Best-effort CHECKPOINT bounded by a timeout, then exit. Never rejects — the
 * exit always fires (in `finally`) even if the CHECKPOINT throws. Fire-and-forget
 * from a signal handler (`void boundedCheckpointBeforeExit({...})`).
 */
export declare function boundedCheckpointBeforeExit(opts: BoundedCheckpointExitOptions): Promise<void>;
