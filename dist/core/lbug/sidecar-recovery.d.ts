export type LbugSidecarState = {
    kind: 'clean';
    dbPath: string;
} | {
    kind: 'wal-with-shadow';
    dbPath: string;
    walBytes: number;
    shadowBytes: number;
} | {
    kind: 'tiny-orphan-wal';
    dbPath: string;
    walBytes: number;
} | {
    kind: 'orphan-wal';
    dbPath: string;
    walBytes: number;
} | {
    kind: 'orphan-shadow';
    dbPath: string;
    shadowBytes: number;
};
export interface SidecarRecoveryLogger {
    warn: (message: string) => void;
    info?: (message: string) => void;
    debug?: (message: string) => void;
}
export declare const TINY_ORPHAN_WAL_BYTES: number;
export declare const isMissingFsError: (err: unknown) => boolean;
export declare const sidecarPreflightDisabled: () => boolean;
export declare const statIfExists: (filePath: string) => Promise<{
    size: number;
} | null>;
export declare const isMissingShadowSidecarError: (err: unknown) => boolean;
export declare const isReadOnlyShadowReplayError: (err: unknown) => boolean;
export declare const shadowSidecarRecoveryMessage: (dbPath: string, err: unknown) => string;
/**
 * Actionable message for the case where LadybugDB reports a "missing shadow"
 * but `inspectLbugSidecars` finds the `.shadow` PRESENT on disk — the open
 * failed on path reachability or a lock, not a genuinely-missing sidecar (issue
 * #2382 review, S2). Unlike `shadowSidecarRecoveryMessage` it does NOT tell the
 * operator to rebuild the index (the remedy is fixing the lock/path). Keeps the
 * `Original error:` tail so downstream `isMissingShadowSidecarError` recognition
 * still matches the wrapped error.
 */
export declare const presentShadowUnreachableMessage: (dbPath: string, err: unknown) => string;
export declare const isPermissionRenameError: (err: unknown) => boolean;
/**
 * Canonical remediation guidance for the LadybugDB file-lock class
 * (EBUSY/EPERM/EACCES — an MCP/serve process holding the index, or an
 * antivirus scan). One exported producer (this shipping review, FIX 7):
 * the dirty-recovery park warning below, `LbugWipeError`'s message builder
 * (lbug-adapter.ts) and {@link renameFailureMessage} previously carried
 * three divergent hand-written copies of the same advice.
 *
 * `rerun` names the command to retry once the lock clears — the analyze
 * wipe/park surfaces re-run the analyze; the read-path quarantine surface
 * re-runs whatever command failed. No trailing period: callers own the
 * sentence end.
 */
export declare const lbugLockRemediation: (rerun?: string) => string;
/**
 * Classify a failure surfaced by quarantine rename into an actionable user-facing
 * message.
 *
 * - EACCES / EPERM / EBUSY → permission-specific message pointing at filesystem
 *   ACLs, AV exclusions, and file-locks. Importantly does NOT instruct the user
 *   to rebuild the index — the underlying problem is environmental, not data
 *   integrity, and re-running after fixing the lock/permission will succeed.
 * - Everything else (including the LadybugDB "Cannot open file *.shadow"
 *   missing-shadow error, ENOSPC, EROFS, EIO, and any other thrown Error) →
 *   falls back to `shadowSidecarRecoveryMessage`, preserving today's behavior.
 *
 * Use at caller catches around `quarantineWalForMissingShadow` and any other
 * path where an `fs.rename`-class failure may surface to operators.
 */
export declare const renameFailureMessage: (dbPath: string, err: unknown) => string;
export declare function inspectLbugSidecars(dbPath: string): Promise<LbugSidecarState>;
/**
 * Reject the WAL-quarantine path when discarding the WAL would be unsafe or
 * wrong. Shared by every reactive missing-shadow recovery consumer — serve (via
 * lbug-adapter's `refuseLargeWalQuarantine`) and the MCP/wiki/augmentation pool
 * (via pool-adapter's `tryQuarantineForMissingShadow`) — so the quarantine
 * safety policy has a single source of truth (issue #2382 review, Finding B).
 *
 *   1. `wal-with-shadow` — the `.shadow` sidecar is PRESENT on disk. A
 *      "missing shadow" error alongside a present shadow means the open failed
 *      on path reachability or a lock (the #1811 non-ASCII path-garble on
 *      Windows), not a genuinely-missing shadow; quarantining would move a live
 *      WAL sitting next to its shadow — data loss.
 *   2. `orphan-wal` — the orphan WAL is too large to safely discard
 *      (>TINY_ORPHAN_WAL_BYTES); preserve the uncheckpointed pages for explicit
 *      operator recovery.
 *
 * Throws `shadowSidecarRecoveryMessage` in either case. Returns silently only
 * when the shadow is absent AND the WAL is absent or tiny — the states where
 * the existing recovery path is safe to proceed. `mode` is a label used only in
 * the warning text (e.g. 'read-only', 'writable', 'pool read-only recovery').
 */
export declare const guardWalQuarantine: (dbPath: string, mode: string, triggeringErr: unknown, logger: SidecarRecoveryLogger) => Promise<void>;
export declare function quarantineWalForMissingShadow(dbPath: string, options: {
    logger: SidecarRecoveryLogger;
    level?: 'debug' | 'info' | 'warn';
    reason?: string;
}): Promise<string>;
export declare function preflightLbugSidecars(dbPath: string, options: {
    mode: 'read-only' | 'write';
    logger: SidecarRecoveryLogger;
    allowQuarantine: boolean;
}): Promise<LbugSidecarState>;
export declare function finalizeLbugSidecarsAfterClose(dbPath: string, options: {
    logger: SidecarRecoveryLogger;
}): Promise<void>;
/**
 * Move the WAL/shadow sidecars aside before a dirty-flag recovery rebuild
 * (#2409 defect 2).
 *
 * When `incrementalInProgress` forces a full rebuild, the previous run
 * died mid-writeback — its WAL can be poisoned in a way that natively
 * kills the process on replay. The recovery run used to open the DB
 * BEFORE the rebuild wipe (the embedding-cache preservation open), replay
 * the poisoned WAL, and die on the spot — so recovery never happened and
 * only a manual rename-aside of the index dir escaped the loop. The
 * rebuild discards every pending WAL byte anyway (the DB files are wiped),
 * so parking the sidecars first costs nothing and makes every subsequent
 * open replay-free.
 *
 * Renamed when possible, so the bytes stay available for post-mortem
 * debugging — and, like {@link quarantineWalForMissingShadow}'s quarantine
 * files, the parked copies are surfaced and removable by
 * `gitnexus clean --lbug-sidecars` (tri-review 4669518496 P2-7; before
 * that, this comment claimed a "same philosophy" parity while the
 * dirty-recovery files were invisible to every cleanup surface). Real
 * lifecycle: the destinations are FIXED names — no timestamp, see
 * {@link listParkedDirtyRecoverySidecars} — so each new crash overwrites
 * the previous parked copy, capping accumulation at one file per sidecar;
 * remove them via `clean --lbug-sidecars` or manually once their
 * post-mortem value has passed.
 *
 * Escalation ladder per suffix (this shipping review, FIX 1 — replacing
 * the drop-shape design, whose park had ZERO retry while the wipe path
 * retried the very same lock class):
 *
 *   1. `rename(from, to)` retried over the shared handle-release budget
 *      (HANDLE_RELEASE_PROBE_ATTEMPTS × linear HANDLE_RELEASE_PROBE_DELAY_MS,
 *      lbug-config.ts) — a transient AV/handle-lag EBUSY must not cost the
 *      run anything.
 *   2. Structural confirm probe: a bare "does `to` exist?" check cannot
 *      discriminate a Windows rename-onto-existing collision from a locked
 *      source that happens to have a leftover parked copy. Renaming the
 *      source to the collision-free `${to}.next` can — success proves the
 *      failure was the collision, so the stale copy is replaced (newest
 *      forensics win). The crash window between the `rm(to)` and the final
 *      promote rename strands the bytes at `.next` — acceptable: `.next`
 *      residues are enumerated by the dirty-recovery lister and removed by
 *      `clean --lbug-sidecars` (FIX 5). Never pre-delete the previous
 *      crash's parked copy on the bet that a rename will then succeed
 *      (tri-review 4669518496 P2-3: the old rm-first shape destroyed the
 *      prior forensics exactly when the source was locked and nothing
 *      replaced them).
 *   3. rm-fallback: the source itself is locked for RENAME, but Windows
 *      lets some holders' files be unlink-marked — retry
 *      `rm(from, {force:true})` over the same budget and require the file
 *      verifiably GONE. Success eliminates the replay risk at the cost of
 *      the post-mortem forensics (logged exactly so).
 *   4. Report in `failed` with the corrected lock guidance — the caller
 *      must abort (run-analyze throws a LbugWipeError in seconds instead
 *      of running the whole pipeline and dying at the wipe on the same
 *      handle).
 *
 * Per-suffix isolation: a `.wal` failure never skips the `.shadow`
 * attempt.
 *
 * INVARIANT: after this function returns, either no original sidecar
 * remains adjacent to the DB — every entry is in `moved` or `removed`, so
 * every subsequent open this run performs is replay-free — or the entry is
 * in `failed` and the caller MUST abort before any DB open.
 *
 * @returns `moved` — destination paths now holding the parked bytes;
 * `removed` — source sidecars whose bytes are GONE (forensics lost, replay
 * risk eliminated); `failed` — source sidecars still in place: a
 * possibly-poisoned sidecar sits next to the DB and any pre-wipe open
 * would replay it and die (there is no "wipe it in place" fallback).
 */
export declare function quarantineSidecarsForDirtyRecovery(dbPath: string, log: (message: string) => void): Promise<{
    moved: string[];
    removed: string[];
    failed: string[];
}>;
export declare function listQuarantinedMissingShadowWals(dbPath: string): Promise<string[]>;
/**
 * Delete the missing-shadow WAL quarantines for `dbPath` and return the
 * deleted paths. Locked files are skipped, not thrown (FIX 5) — user-facing
 * surfaces should call {@link cleanParkedLbugSidecars}, which also REPORTS
 * the skipped files.
 */
export declare function cleanQuarantinedMissingShadowWals(dbPath: string): Promise<string[]>;
/**
 * List the `.dirty-recovery` sidecars parked beside `dbPath` by
 * {@link quarantineSidecarsForDirtyRecovery}, so `gitnexus clean
 * --lbug-sidecars` can surface them next to the missing-shadow quarantines
 * (tri-review 4669518496 P2-7 — they were previously invisible to every
 * cleanup surface). Only fixed names can exist (see
 * {@link dirtyRecoveryParkedNames}: `<dbPath>.wal.dirty-recovery`,
 * `<dbPath>.shadow.dirty-recovery`, and their `.next` probe residues from a
 * double park failure — enumerated since FIX 5 of this shipping review; the
 * docs used to say "remove manually" while no surface even listed them), so
 * this stats them directly instead of prefix-scanning the directory the way
 * the timestamped missing-shadow lister must.
 *
 * Returns existing parked files as sorted absolute paths. Branch-scoped
 * index slots (`branches/<slug>/`) are outside `clean.ts`'s flat-path
 * resolution — the same documented limitation as the missing-shadow pair.
 */
export declare function listParkedDirtyRecoverySidecars(dbPath: string): Promise<string[]>;
/**
 * Delete the `.dirty-recovery` parked sidecars for `dbPath` and return the
 * deleted paths. Sibling of {@link cleanQuarantinedMissingShadowWals}; same
 * skip-not-throw policy (FIX 5) — user-facing surfaces should call
 * {@link cleanParkedLbugSidecars}, which also reports locked files.
 */
export declare function cleanParkedDirtyRecoverySidecars(dbPath: string): Promise<string[]>;
/**
 * Aggregate roster of every parked/quarantined sidecar family beside
 * `dbPath` (this shipping review, FIX 5): the timestamped missing-shadow
 * WAL quarantines plus the fixed-name dirty-recovery parks (`.next`
 * residues included). Single roster authority for `clean --lbug-sidecars`
 * — the command previously concatenated the families inline in two places,
 * which is how the `.next` residue stayed invisible.
 */
export declare function listParkedLbugSidecars(dbPath: string): Promise<string[]>;
/**
 * Delete every file {@link listParkedLbugSidecars} enumerates. Per-file
 * error policy via {@link unlinkParkedFiles}: ENOENT skipped silently,
 * locked files collected into `failed` while the rest are still deleted —
 * a locked parked file must not crash the whole clean mid-command.
 */
export declare function cleanParkedLbugSidecars(dbPath: string): Promise<{
    deleted: string[];
    failed: string[];
}>;
export declare const _resetSidecarRecoveryWarningsForTest: () => void;
