import type lbug from '@ladybugdb/core';
export declare function cleanupNativePathJunctions(): void;
export declare function toNativeSafePath(p: string): string;
/**
 * Resolve the on-disk CSV staging dir for `<storagePath>/<subdir>`, applying the
 * same ASCII-safe relocation `toNativeSafePath` enables: on Windows with a
 * non-ASCII storage path, LadybugDB's bulk COPY cannot open files under that
 * path, so the dir is relocated under `os.tmpdir()`. Shared by the structural
 * `csv/` dir and the streaming `pdg-csv/` dir (#2202) so the two can never
 * diverge on platform handling; the `gitnexus-<subdir>-` prefix keeps their tmp
 * locations distinct and recognizable.
 *
 * The relocated dir is created with `fs.mkdtempSync` (a unique, mode-0700,
 * guaranteed-not-pre-existing suffix) rather than a deterministic
 * `gitnexus-<subdir>-<hash>` name. A predictable name in the world-readable OS
 * temp dir is information-disclosure-prone and pre-plantable
 * (CWE-377/378 / CodeQL `js/insecure-temporary-file`); mkdtemp's random suffix
 * is the documented mitigation and is what reaches the streaming sink's
 * `fs.openSync`. The non-Windows / ASCII path stays a pure `path.join` (no dir
 * created) and is byte-identical to before.
 */
export declare function resolveNativeSafeStorageDir(storagePath: string, subdir: string): string;
/**
 * Shared configuration for `@ladybugdb/core` `Database` construction.
 *
 * Two values changed meaningfully in `@ladybugdb/core` 0.16.0 and need to be
 * pinned explicitly by every caller, otherwise GitNexus regresses:
 *
 * 1. `maxDBSize` defaults to `0`, which the native runtime interprets as
 *    "use the platform's full mmap address space" — typically 8 TB on
 *    64-bit Linux. Constrained environments (CI runners, containers, WSL)
 *    cannot reserve that much address space and crash with
 *    `Buffer manager exception: Mmap for size 8796093022208 failed.`
 *    See LadybugDB upstream JSDoc:
 *    > "introduced temporarily for now to get around with the default 8TB
 *    > mmap address space limit some environment".
 *
 * 2. `enableCompression` flipped its default from `false` (0.15.x) to
 *    `true` (0.16.0). Existing call sites that relied on the positional
 *    default must now pass `false` explicitly to preserve behaviour.
 *
 * 3. `bufferManagerSize` (not a 0.16.0 change, same pin-explicitly
 *    principle): `0` means "native default", and the native default buffer
 *    pool is 80% of physical RAM. A long-lived `gitnexus mcp` process or a
 *    large incremental analyze can balloon to that ceiling and OOM-kill the
 *    host session (#2557), so GitNexus pins an explicit bounded pool — see
 *    `resolveBufferManagerSize`.
 *
 * Putting these in one shared module guarantees every `new lbug.Database(...)`
 * call site agrees on the same ceilings and behaviour.
 */
/**
 * Upper bound for any single GitNexus LadybugDB file (graph index, group
 * bridge, install scratch, test fixture). 16 GiB is intentionally generous
 * for real-world code graphs (the GitNexus self-index uses < 50 MiB) while
 * remaining far below any 64-bit OS mmap ceiling.
 *
 * Override with the `GITNEXUS_LBUG_MAX_DB_SIZE` environment variable when
 * indexing genuinely huge monorepos. Values are coerced to a positive
 * integer; anything invalid falls back to the default.
 */
export declare const LBUG_MAX_DB_SIZE: number;
export declare const parseWalCheckpointThreshold: (raw: string | undefined) => number | undefined;
/**
 * How much the OS page size amplifies buffer-pool consumption (#2631).
 *
 * LadybugDB's VM region charges pool budget per DISCARD GRANULE, not per
 * frame: `discardGranuleSize = max(frameSize, osPageSize)` (vm_region.cpp),
 * `claimFrame` bills the whole granule when its first 4 KiB frame becomes
 * resident, and `releaseFrame` refunds only when the granule's LAST frame
 * leaves. On a 64 KiB-page kernel (aarch64 openEuler — Ascend hosts) that is
 * 16 frames per granule: scattered access is billed up to 16× its real bytes,
 * and whole eviction passes can evict frames yet refund nothing — which is
 * exactly the engine's "buffer pool is full and no memory could be freed"
 * throw. Apple Silicon macOS (16 KiB pages) is the same mechanism at 4×.
 *
 * So the ANALYZE-path pool sizes (the per-element estimate, the COPY-safety
 * floor, and the cap the hint is clamped against) are scaled by this ratio:
 * the budget must cover worst-case granule charging or COPY dies on non-4K
 * hosts with a pool that would be ample on x86. The hintless default
 * (defaultBufferPoolSize — MCP serve, doctor, native-check) is deliberately
 * NOT scaled: the pool is a native eager allocation committed at DB open
 * (measured — see POOL_BYTES_PER_ELEMENT below), so scaling the global
 * default would revert the #2557 OOM cap on every 16 KiB/64 KiB host. If the
 * engine ever charges per-frame (or ships page-size-matched frames), this
 * collapses back to 1 and the scaling disappears.
 *
 * Fail-safe: an undetectable page size (win32 — where the granule mechanism
 * is absent anyway — or a failed `getconf`) means ratio 1, i.e. today's
 * behavior.
 */
export declare const granuleRatio: (pageSize?: number | undefined) => number;
/**
 * Size the buffer pool to an estimated graph size (node + relationship count),
 * clamped to [ADAPTIVE_POOL_FLOOR, scaledAnalyzePoolCap], with every term
 * scaled by granuleRatio (#2631): on non-4K hosts the engine bills pool
 * budget per OS-page-sized granule, so the same graph consumes up to
 * pageSize/4096 × the budget it needs on x86. On 4 KiB hosts the ratio is 1
 * and this is byte-identical to the pre-#2631 behavior. The estimate is never
 * above the page-size-scaled #2557 cap bounded by 80% of RAM, never below the
 * scaled COPY-safety floor; the hintless default stays unscaled.
 *
 * `pageSize` is a test seam (the pageSizeDoctorLines convention); production
 * callers omit it and get the memoized real OS page size.
 */
export declare const estimateBufferPool: (graphElementCount: number, pageSize?: number | undefined) => number;
/** Set (bytes) or clear (`undefined`) the per-run buffer-pool size hint. */
export declare const setBufferPoolSizeHint: (bytes: number | undefined) => void;
/**
 * Doctor-facing view of the pool size the next Database open would get
 * (#2631): env override > clamped hint > unscaled hintless default. Read-only;
 * doctor prints it next to the page-size lines so support triage sees the
 * sizing inputs at a glance. `0` is the pass-through sentinel for LadybugDB's
 * native 80%-of-RAM default — callers must label it, not print "0 MiB".
 */
export declare const getEffectiveBufferPoolSize: () => number;
/**
 * Actionable remedy for a buffer-pool exhaustion error (#2631), or undefined
 * when `message` is not that class. Cause → consequence → remedy, the
 * diagnoseExtensionLoad convention: names the effective pool, the override
 * knob, and — on non-4K hosts — the granule amplification that makes the
 * budget exhaust early (the reporter's Ascend/aarch64 64 KiB kernel billed a
 * pool up to 16× faster than the same analyze on x86).
 */
export declare const bufferPoolExhaustionRemedy: (message: string, pageSize?: number | undefined) => string | undefined;
export declare const WAL_RECOVERY_SUGGESTION = "WAL corruption detected. Run `gitnexus analyze --force` to rebuild the index.";
export declare function isWalCorruptionError(err: unknown): boolean;
/**
 * True when `err` looks like a Ladybug WAL-checkpoint rotation/remove IO
 * failure. Tries strict matchers first (renames + removes), then falls
 * back to the permissive matcher.
 */
export declare const isLbugCheckpointIoError: (err: unknown) => boolean;
/**
 * True when `err` looks like the LadybugDB buffer manager failing to release
 * frame memory — the failure mode of a 4 KiB page-size assumption on a
 * 16 KiB/64 KiB-page kernel (#1231). Deliberately does NOT match the
 * generic "buffer pool is full" exhaustion error: that one is handled as a
 * SIZING problem — though since #2631 we know page size drives sizing too
 * (the engine bills pool budget per OS-page-sized discard granule, so non-4K
 * hosts exhaust the same budget up to pageSize/4096× earlier; see
 * granuleRatio, which scales the pool accordingly, and
 * bufferPoolExhaustionRemedy, which explains it to the operator).
 */
export declare const isLbugPageSizeFrameError: (err: unknown) => boolean;
/**
 * True when the given `@ladybugdb/core` version contains the runtime
 * OS-page-size detection introduced in 0.18.0 (see the matcher comment
 * above). Unknown/unparseable versions return false so callers err on the
 * side of showing the upgrade hint.
 */
export declare const isPageSizeAwareLadybug: (version: string | undefined) => boolean;
/**
 * Test seam (the `_captureLogger` convention): pin the memoized OS page size
 * so sizing tests are host-independent — without this they would silently
 * drift on 16 KiB-page Apple Silicon runners. `number` pins a value, `null`
 * pins "undetectable", `undefined` clears the memo so the next call re-probes.
 */
export declare const _setOsPageSizeForTests: (pageSize: number | null | undefined) => void;
/**
 * OS memory page size in bytes, or `undefined` when it cannot be determined
 * (Windows, missing getconf, sandboxed exec). Node exposes no page-size API,
 * so this shells out to POSIX `getconf PAGE_SIZE` — same execFileSync shape
 * as the Windows 8.3 short-path probe above, but with a tighter timeout and
 * an explicit killSignal (see the options comment below).
 */
export declare const getOsPageSize: () => number | undefined;
type LbugModule = typeof lbug;
export interface LbugDatabaseOptions {
    readOnly?: boolean;
    throwOnWalReplayFailure?: boolean;
}
export interface LbugConnectionHandle {
    db: lbug.Database;
    conn: lbug.Connection;
}
/**
 * Return true when the error message indicates that a LadybugDB write
 * transaction could not proceed due to lock contention — either a file
 * lock that could not be acquired (either at construction time,
 * `new lbug.Database(...)` raising from `local_file_system.cpp`, or during
 * a query, another writer holds the exclusive lock), or a same-process
 * write transaction rejected because another write transaction is already
 * active on the connection.
 *
 * Lives here (not in `lbug-adapter.ts`) so both the construction-time
 * retry (`openWithLockRetry` in this file) and the query-time retry
 * (`withLbugDb` in `lbug-adapter.ts`) consult the same matcher. Callers
 * import directly from this module — no re-export to keep in sync.
 */
export declare const isDbBusyError: (err: unknown) => boolean;
/**
 * True when a WAL-checkpoint IO error ALSO carries a busy/lock signal — the
 * rotation failed because another handle (a `gitnexus mcp` server, or this
 * process's own reader) holds the store's WAL open, rather than a permanent
 * disk error. Reuses `isDbBusyError`'s already-tested keyword set instead of a
 * fresh regex, so an unmatched message degrades to "IO error" rather than
 * silently claiming a held-open cause. (#2599)
 */
export declare const isLbugCheckpointBusyError: (err: unknown) => boolean;
/** See {@link classifyDeleteAllError}. */
export type DeleteAllErrorClass = 'benign-missing-table' | 'rethrow';
/**
 * Classify an error thrown while clearing all relationships of one type
 * before an incremental re-write (`deleteAllRelationshipsOfType` in
 * `lbug-adapter.ts` — the `deleteAllInjects` / `deleteAllCallSummaries` /
 * `deleteAllInterprocTaintPaths` family).
 *
 * - `'benign-missing-table'`: the CodeRelation table does not exist yet
 *   (freshly-initialized DB) — the delete-all is a no-op, stay silent.
 * - `'rethrow'`: ANY other failure (lock, disk, closed connection, native
 *   error) leaves stale rows that the subsequent re-extract then DUPLICATES
 *   (CodeRelation has no PK), so the caller must abort the writeback
 *   (#2084 review P2-5).
 *
 * Pure classification, extracted here (next to the other error matchers) so
 * the load-bearing regex/branch is unit-testable without a native DB —
 * driving a synthetic failure through the real singleton connection would
 * break every later test in the shared integration suite (#2200 review).
 */
export declare const classifyDeleteAllError: (err: unknown) => DeleteAllErrorClass;
export declare function createLbugDatabase(lbugModule: LbugModule, databasePath: string, options?: LbugDatabaseOptions): lbug.Database;
export declare const HANDLE_RELEASE_PROBE_ATTEMPTS = 5;
export declare const HANDLE_RELEASE_PROBE_DELAY_MS = 50;
/**
 * Marker symbol attached to lock errors after `openWithLockRetry` exhausts
 * its budget. `withLbugDb`'s outer query-time retry consults this so it
 * does not re-retry a path that just spent up to ~1.5s in the open-time
 * loop — preventing 6s tail latencies (3× outer × 5× inner attempts).
 *
 * The symbol is internal to GitNexus; consumers should treat the underlying
 * error message as the user-visible signal.
 */
export declare const LBUG_OPEN_RETRY_EXHAUSTED: unique symbol;
export declare const isOpenRetryExhausted: (err: unknown) => boolean;
/** Exported only for direct unit testing — production callers use `openWithLockRetry`. */
export declare const _isTestFixturePathForTest: (dbPath: string) => boolean;
export declare const sleep: (ms: number) => Promise<void>;
export declare function openLbugConnection(lbugModule: LbugModule, databasePath: string, options?: LbugDatabaseOptions): Promise<LbugConnectionHandle>;
export declare function closeLbugConnection(handle: LbugConnectionHandle): Promise<void>;
/**
 * Probe `dbPath` AND its `.wal` sidecar after `db.close()` so any
 * residual native file handle surfaces as EBUSY/EPERM/EACCES and the
 * bounded retry absorbs the release lag. Windows-only — Linux/macOS do
 * not exhibit this race.
 *
 * Both files matter. Empirically, on rapid open→close→reopen cycles the
 * main `dbPath` handle releases first; the `.wal` handle from the
 * previous Database lingers and the new Database's first write (CREATE
 * NODE TABLE during schema init) fails with "Could not set lock on
 * file". Probing both makes safeClose actually return when the kernel
 * is fully done with the path.
 *
 * Returns `true` when both probes succeeded (or skipped on non-lock
 * errors / missing files). Returns `false` when either probe exhausted
 * its budget with a lock code still in flight.
 *
 * Defensive shape:
 *   - Opens read+write (`'r+'`) so the probe actually surfaces exclusive
 *     locks held by the previous Database. A read-only probe (`'r'`) is
 *     insufficient — Windows will grant read access while the previous
 *     handle's exclusive write lock is still in flight, which lets
 *     `safeClose` return before the next CREATE NODE TABLE can lock the
 *     file.
 *   - `try/finally` around `handle.close()` guarantees no fd leak even
 *     if close itself throws.
 */
export declare const waitForWindowsHandleRelease: (dbPath: string) => Promise<boolean>;
export {};
