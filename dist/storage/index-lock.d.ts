declare const LOCK_RECORD_VERSION: 1;
/**
 * On-disk lock record. `token` proves ownership on release/steal; `startTime`
 * (Linux only) defends against pid reuse; `invocationId` is a human-traceable
 * id distinct from the security-irrelevant `token`.
 */
export interface LockRecord {
    v: typeof LOCK_RECORD_VERSION;
    pid: number;
    hostname: string;
    /** /proc/<pid>/stat starttime (clock ticks) on Linux; null where unavailable. */
    startTime: string | null;
    token: string;
    invocationId: string;
    acquiredAt: string;
}
export interface IndexLockHandle {
    /** Our own record — `invocationId` is shown to waiters as the holder id. */
    readonly record: LockRecord;
    /** Idempotent; only removes the lock file if it still carries our token. */
    release(): void;
}
export interface AcquireOptions {
    log?: (msg: string) => void;
    /**
     * Give up waiting after this long (ms), throwing {@link IndexLockTimeoutError}.
     * Default: {@link DEFAULT_TIMEOUT_MS} ({@link resolveTimeoutMs}). A finite
     * default is deliberate: on platforms without process start-time verification
     * (anything but Linux — see {@link readProcStartTime}) a crashed holder whose
     * pid was reused by an unrelated long-lived process reads as a live holder and
     * would otherwise block acquisition forever. Timing out is safe — it stops
     * *waiting*, never *steals* a possibly-live holder — and names the holder so
     * the caller can retry. Override (including to unbounded, value ≤ 0) via
     * GITNEXUS_INDEX_LOCK_TIMEOUT_MS.
     */
    timeoutMs?: number;
    /** Base poll interval (ms); jittered. Default 250. */
    pollMs?: number;
    /** Called once when we start waiting on a live holder. */
    onWaitStart?: (holder: LockRecord) => void;
}
export declare class IndexLockTimeoutError extends Error {
    readonly holder: LockRecord;
    /**
     * Whether `holder` carries a real, identifiable owner. False on the socket
     * backend (and the file backend's malformed/vanished-lock timeouts), where the
     * holder is a placeholder (`pid -1`) — the OS socket lock exposes no owner
     * metadata (#2658 review M3). Consumers must not present `holder.pid` as a real
     * pid when this is false.
     */
    readonly holderKnown: boolean;
    constructor(holder: LockRecord, waitedMs: number, holderKnown?: boolean);
}
/**
 * Filesystem-create error codes we tolerate by proceeding lock-free: a
 * read-only mount (EROFS) or a denied create (EACCES/EPERM). Such a filesystem
 * rejects every index WRITE in the same directory too, so no concurrent writer
 * can exist and the lock is moot — an already-indexed repo on a `:ro` mount
 * must still reach its `alreadyUpToDate` fast path (#2658). A genuinely-needed
 * write fails later exactly as it would have without the lock.
 */
export declare const LOCK_UNWRITABLE_CODES: ReadonlySet<string>;
export declare const isLockUnwritableCode: (code: string | undefined) => boolean;
/**
 * Delete orphaned build/staging artifacts left in the lock directory by a
 * crashed prior writer. Safe precisely because we hold the exclusive lock: no
 * other writer can be creating these here right now, so anything present is a
 * crash orphan. Matches this slot's staging files ONLY — never `lbug` itself,
 * never `lbug.wal`/`lbug.shadow` (the LIVE index's own sidecars), and never a
 * `branches/<slug>/` sub-slot (which owns its own lock + sweep). Non-recursive.
 */
export declare const sweepStagingArtifacts: (lockDir: string, log?: (msg: string) => void) => void;
/**
 * Acquire the exclusive write lock for `lockDir` (the resolved index slot
 * directory). Uses the OS socket/pipe backend where available (Windows/Linux),
 * falling back to the file backend otherwise or if the socket backend is
 * unusable in this environment. After acquiring, sweeps orphaned staging files
 * under the lock (best-effort; a no-op on a read-only mount). Rejects with
 * `IndexLockTimeoutError` if `timeoutMs` elapses while another live holder holds
 * the lock.
 */
export declare const acquireIndexLock: (lockDir: string, opts?: AcquireOptions) => Promise<IndexLockHandle>;
export {};
