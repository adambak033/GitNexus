import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import lbug from '@ladybugdb/core';
import { BRIDGE_SCHEMA_QUERIES, BRIDGE_SCHEMA_VERSION } from './bridge-schema.js';
import { closeLbugConnection, openLbugConnection, } from '../lbug/lbug-config.js';
import { dedupeContracts, dedupeCrossLinks } from './normalization.js';
import { createLogger } from '../logger.js';
import { retryRename, writeFileAtomic } from '../../storage/fs-atomic.js';
const bridgeLogger = createLogger('bridge-db', {
    debugEnvVar: 'GITNEXUS_DEBUG_BRIDGE',
});
/**
 * Sidecar files that LadybugDB creates next to a `bridge.lbug` file.
 *
 * - `.wal` — write-ahead log; persists across opens but must be associated
 *   with the same database instance (LadybugDB 0.16.0 enforces this via a
 *   database-id check and rejects opens with the diagnostic
 *   `"Database ID for temporary file 'X.wal' does not match the current
 *   database. This file may have been left behind from a previous database
 *   with the same name"`).
 * - `.shadow` — non-blocking concurrent checkpoint sidecar (added in
 *   LadybugDB 0.15.4); same pairing constraint as `.wal`.
 *
 * `bridge-db` writes to a `bridge.lbug.tmp.<random>` file and then atomically renames
 * it into place. The rename only moves the main file; sidecars must be
 * cleaned up explicitly or the next writer trips the database-id check.
 */
const LBUG_SIDECAR_SUFFIXES = ['.wal', '.shadow'];
/**
 * Windows-only bound on how long `invalidateBridgeCache` waits for in-flight
 * readers to release before letting `writeBridge` rename. Past this, it falls
 * through and `retryRename` (EBUSY ×3) copes — so a pathologically long reader
 * can never wedge `group_sync`. ponytail: fixed 5s ceiling; make it
 * configurable if a real workload shows reads routinely outlasting it.
 */
const WINDOWS_DRAIN_TIMEOUT_MS = 5000;
const cachedBridgeHandles = new Map();
/**
 * Reverse lookup: cache entry by its `BridgeHandle`. Lets `queryBridge` and
 * `closeBridgeDb` find an entry from just the handle — including an *evicted*
 * entry that is no longer in `cachedBridgeHandles` but whose native handle a
 * lease still holds open. Uncached/writable handles (the `writeBridge` temp DB)
 * are absent here, which is how those paths opt out of the lock and refcount.
 */
const bridgeEntryByHandle = new WeakMap();
/**
 * In-flight opens keyed by groupDir. Prevents the TOCTOU race where two
 * concurrent cache-miss calls both open a fresh handle and the second
 * overwrites the first in `cachedBridgeHandles` — leaking the first
 * handle. Mirrors the `local-backend.ts:1293` reinitPromises pattern.
 */
const inFlightOpens = new Map();
function bridgeCacheKey(groupDir) {
    return path.resolve(groupDir);
}
/**
 * Serialize an operation on a cached handle's per-handle FIFO chain. Mirrors the
 * promise-chain mechanic of `lbug/conn-lock.ts` (install a fresh unresolved
 * tail, await the prior holder, release in `finally` so a throw never wedges the
 * chain) — but keyed per handle, not a single global lock. No re-entry guard:
 * `queryBridge` is a leaf (it never calls another locked bridge helper), and the
 * native close runs outside the lock gated on `refs === 0`.
 */
export async function withHandleLock(lock, fn) {
    const prior = lock.lockTail;
    let release;
    lock.lockTail = new Promise((resolve) => {
        release = resolve;
    });
    await prior;
    try {
        return await fn();
    }
    finally {
        release();
    }
}
/**
 * Close a cached entry's native handle exactly once. Guarded by `closeStarted`
 * so the mtime-evict path, `invalidateBridgeCache`, the last lease release, and
 * `closeAllCachedBridges` can all reach here and only one native close runs.
 */
async function finalizeBridgeClose(entry) {
    if (entry.closeStarted)
        return;
    entry.closeStarted = true;
    bridgeEntryByHandle.delete(entry.handle);
    try {
        await closeBridgeHandle(entry.handle);
    }
    finally {
        entry.resolveDrained();
    }
}
/**
 * Remove an entry from the cache and release its native handle. The native
 * close is DEFERRED until in-flight leases drain (`refs === 0`): closing a
 * handle a concurrent `@group` reader is still querying is a native
 * use-after-free (the `conn-lock.ts` hazard). When `refs === 0` (the common
 * single-threaded case — e.g. `group_sync` with no concurrent read) the close
 * runs now and the returned promise resolves when it completes, so
 * `writeBridge`'s atomic rename never races a live RO handle on Windows.
 *
 * When `refs > 0` (a concurrent reader holds a lease), the native close is
 * deferred to the last `closeBridgeDb` release — closing now would be a
 * use-after-free. Platform split for the rename that follows:
 *   - POSIX: return immediately. The rename succeeds over the still-open RO
 *     handle (old inode survives for the reader); no wait, no starvation.
 *   - Windows: a rename over an open handle fails (EBUSY), so wait — bounded by
 *     `WINDOWS_DRAIN_TIMEOUT_MS` — for the reader to release and the deferred
 *     close to complete, then the rename is clean. On timeout, fall through and
 *     let `retryRename` cope, so a slow reader can never wedge `group_sync`.
 *
 * This is the single eviction path for BOTH the mtime-change branch and
 * `invalidateBridgeCache`.
 */
async function evictBridgeEntry(key, entry) {
    if (!entry.evicted) {
        entry.evicted = true;
        if (cachedBridgeHandles.get(key) === entry)
            cachedBridgeHandles.delete(key);
    }
    if (entry.refs <= 0) {
        await finalizeBridgeClose(entry);
        return;
    }
    // refs > 0: close deferred to the last closeBridgeDb release.
    if (process.platform === 'win32') {
        // Windows needs the handle closed before writeBridge renames. Wait (bounded)
        // for readers to drain; on timeout, retryRename handles the residual EBUSY.
        let timer;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(resolve, WINDOWS_DRAIN_TIMEOUT_MS);
        });
        await Promise.race([entry.drained, timeout]).finally(() => clearTimeout(timer));
    }
}
/**
 * Close a BridgeHandle's native resources without touching the cache.
 * Shared by `closeBridgeDb` (uncached handles) and the cache invalidation
 * / shutdown paths so neither duplicates the close logic.
 */
async function closeBridgeHandle(handle) {
    if (!handle._readOnly) {
        try {
            await handle._conn.query('CHECKPOINT');
        }
        catch {
            /* ignore — older LadybugDB or schemaless DB may not accept it */
        }
    }
    try {
        await handle._conn.close();
    }
    catch {
        /* ignore */
    }
    try {
        await handle._db.close();
    }
    catch {
        /* ignore */
    }
}
/**
 * Get or create a cached read-only bridge handle for `groupDir`.
 *
 * - First call: delegates to `openBridgeDbReadOnly`, records the file's
 *   `mtimeMs`, and caches the handle.
 * - Subsequent calls (mtime unchanged): returns the cached handle — no
 *   reopen, no OS file-handle churn.
 * - After the file's mtime changes (external writer, e.g. another process
 *   ran `gitnexus group sync`): closes the stale handle, opens a fresh
 *   one, and updates the cache.
 * - After the file disappears (ENOENT): invalidates cache, returns null.
 *
 * Returns `null` when the bridge file is missing, has an incompatible
 * schema version, or cannot be opened even after the retry loop in
 * `openBridgeDbReadOnly`.
 */
export async function getCachedBridgeReadOnly(groupDir) {
    const key = bridgeCacheKey(groupDir);
    const dbPath = path.join(groupDir, 'bridge.lbug');
    // Fast path: cache hit, unchanged mtime → lease the cached handle.
    const entry = cachedBridgeHandles.get(key);
    if (entry) {
        try {
            const stat = await fsp.stat(dbPath);
            // Re-check `evicted` AFTER the await: a concurrent writeBridge/invalidate
            // may have evicted this entry while we awaited `stat`. Leasing an evicted
            // (closing) handle would be a use-after-close. The `refs++` is the first
            // synchronous statement after the check, so no evictor can slip between.
            if (!entry.evicted && stat.mtimeMs === entry.mtime) {
                entry.refs++;
                return entry.handle;
            }
        }
        catch {
            // File disappeared (ENOENT) — fall through to evict + reopen.
        }
        // mtime changed or file gone — evict (defers the native close if a
        // concurrent reader still holds a lease; closes now otherwise).
        if (!entry.evicted)
            await evictBridgeEntry(key, entry);
    }
    // TOCTOU guard: if another caller is already opening for this key, await
    // their in-flight promise and take a lease on the result instead of opening
    // a second handle.
    const inFlight = inFlightOpens.get(key);
    if (inFlight) {
        const handle = await inFlight;
        if (!handle)
            return null;
        // Same post-await guard as the fast path: the opener's entry may have been
        // evicted between caching and this awaiter resuming. Only lease a live,
        // identity-matched entry; otherwise retry from the top for a fresh handle.
        const opened = cachedBridgeHandles.get(key);
        if (opened && !opened.evicted && opened.handle === handle) {
            opened.refs++;
            return handle;
        }
        return getCachedBridgeReadOnly(groupDir);
    }
    const openPromise = (async () => {
        try {
            const handle = await openBridgeDbReadOnly(groupDir);
            if (!handle)
                return null;
            let mtime = 0;
            try {
                const stat = await fsp.stat(dbPath);
                mtime = stat.mtimeMs;
            }
            catch {
                // bridge.lbug not stat-able right after open (rare race). Leaving
                // mtime at 0 means the next call's fast-path comparison won't match
                // (a real file's mtime is never 0), so it re-opens. Benign: the handle
                // still works for this caller; we just don't cache-reuse it until a
                // later open records a real mtime.
            }
            let resolveDrained;
            const drained = new Promise((resolve) => {
                resolveDrained = resolve;
            });
            const newEntry = {
                handle,
                mtime,
                refs: 0,
                evicted: false,
                closeStarted: false,
                lockTail: Promise.resolve(),
                drained,
                resolveDrained,
            };
            cachedBridgeHandles.set(key, newEntry);
            bridgeEntryByHandle.set(handle, newEntry);
            return handle;
        }
        finally {
            inFlightOpens.delete(key);
        }
    })();
    inFlightOpens.set(key, openPromise);
    // Each caller (the opener and every awaiter) takes exactly one lease here, so
    // refs counts callers correctly even under inFlightOpens coalescing.
    const handle = await openPromise;
    if (!handle)
        return null;
    const opened = cachedBridgeHandles.get(key);
    if (opened && !opened.evicted && opened.handle === handle) {
        opened.refs++;
        return handle;
    }
    return getCachedBridgeReadOnly(groupDir);
}
/**
 * Invalidate the cached read-only handle for `groupDir`. Drops it from the
 * cache immediately; the native close is deferred until any in-flight reader
 * leases drain (see {@link evictBridgeEntry}). With no concurrent reader this
 * resolves only after the handle is actually closed — which is why
 * `writeBridge` awaits it before its atomic rename (Windows: a still-open RO
 * handle would block the rename with EBUSY).
 */
export async function invalidateBridgeCache(groupDir) {
    const key = bridgeCacheKey(groupDir);
    const entry = cachedBridgeHandles.get(key);
    if (entry)
        await evictBridgeEntry(key, entry);
}
/**
 * Close ALL cached bridge handles. Call on process shutdown only — it force-
 * closes regardless of refs (safe at `beforeExit`, which fires only at
 * event-loop quiescence, so no query is in flight). Do NOT wire this to a
 * SIGTERM/SIGINT handler that can fire mid-request: that would close a handle
 * under a live query. Routes through `finalizeBridgeClose` for the close-once
 * guarantee.
 */
export async function closeAllCachedBridges() {
    const entries = [...cachedBridgeHandles.values()];
    cachedBridgeHandles.clear();
    await Promise.all(entries.map((e) => finalizeBridgeClose(e)));
}
// Best-effort process-exit cleanup. 'beforeExit' fires before 'exit' and
// lets async work drain (unlike 'exit' which is synchronous-only). It does
// NOT fire on process.exit()/SIGTERM/SIGINT — but that is fine here: the OS
// reclaims all handles on any exit path, and for read-only handles there is
// no WAL to flush, so the only thing lost on signal death is a tidy close
// (cosmetic). We deliberately do NOT register a SIGTERM/SIGINT handler: a
// signal can fire mid-request, and closeAllCachedBridges force-closes
// regardless of refs, which would close a handle under a live query. Shutdown
// sequencing is the MCP server's responsibility — it should call
// closeAllCachedBridges() at a quiescent point (also how tests get a
// deterministic teardown).
process.once('beforeExit', () => {
    void closeAllCachedBridges();
});
async function removeLbugFile(basePath) {
    const candidates = [basePath, ...LBUG_SIDECAR_SUFFIXES.map((s) => `${basePath}${s}`)];
    for (const f of candidates) {
        try {
            await fsp.rm(f, { recursive: true, force: true });
        }
        catch {
            /* best-effort: caller will surface real errors via the open path */
        }
    }
}
export function contractNodeId(repo, contractId, role, filePath) {
    return createHash('sha256').update(`${repo}\0${contractId}\0${role}\0${filePath}`).digest('hex');
}
export function createContractLookupIndex() {
    return {
        byUid: new Map(),
        byRef: new Map(),
        byFile: new Map(),
    };
}
function uidKey(repo, role, symbolUid) {
    return `${repo}\0${role}\0${symbolUid}`;
}
function refKey(repo, role, filePath, symbolName) {
    return `${repo}\0${role}\0${filePath}\0${symbolName}`;
}
function fileKey(repo, role, filePath) {
    return `${repo}\0${role}\0${filePath}`;
}
/**
 * Add a successfully-inserted contract to the lookup index. Must be called
 * AFTER the DB insert succeeds (not before) so failed inserts don't poison
 * the index and cause cross-links to point at non-existent rows.
 */
export function indexContract(index, contract, nodeId) {
    if (contract.symbolUid) {
        index.byUid.set(uidKey(contract.repo, contract.role, contract.symbolUid), nodeId);
    }
    index.byRef.set(refKey(contract.repo, contract.role, contract.symbolRef.filePath, contract.symbolRef.name), nodeId);
    const fk = fileKey(contract.repo, contract.role, contract.symbolRef.filePath);
    const existing = index.byFile.get(fk);
    if (existing) {
        existing.push(nodeId);
    }
    else {
        index.byFile.set(fk, [nodeId]);
    }
}
/**
 * Resolve a cross-link endpoint (consumer or provider reference) to an
 * already-inserted contract node id. Returns `null` if no match — the
 * caller is expected to count that as a dropped link in `WriteBridgeReport`.
 *
 * The resolution order matches the pre-cache DB-query behavior:
 *   1. exact `symbolUid` match in the same `(repo, role)` scope
 *   2. exact `(filePath, symbolName)` match
 *   3. if exactly one contract lives in the file → that one (fallback for
 *      legacy graph-assisted extractors that couldn't resolve a symbol name)
 *
 * This is a pure function — no I/O, no DB — so it's trivial to unit-test
 * in isolation (which was the reviewer's main clean-code concern on the
 * original 35-line inner closure in `writeBridge`).
 */
export function findContractNode(index, repo, role, symbolUid, filePath, symbolName) {
    if (symbolUid) {
        const uidHit = index.byUid.get(uidKey(repo, role, symbolUid));
        if (uidHit !== undefined)
            return uidHit;
    }
    const refHit = index.byRef.get(refKey(repo, role, filePath, symbolName));
    if (refHit !== undefined)
        return refHit;
    const fileCandidates = index.byFile.get(fileKey(repo, role, filePath));
    if (fileCandidates && fileCandidates.length === 1)
        return fileCandidates[0];
    return null;
}
export async function openBridgeDb(dbPath) {
    const parentDir = path.dirname(dbPath);
    await fsp.mkdir(parentDir, { recursive: true });
    const { db, conn } = await openLbugConnection(lbug, dbPath);
    return { _db: db, _conn: conn, groupDir: parentDir };
}
/**
 * LadybugDB returns an error whose message contains this substring when a
 * CREATE NODE TABLE or CREATE REL TABLE statement hits an already-existing
 * table. LadybugDB DDL doesn't support IF NOT EXISTS, and its JS driver
 * doesn't expose typed error codes, so we match on the message substring —
 * the same pattern used by `core/lbug/lbug-adapter.ts`. If a future
 * LadybugDB release changes the wording, update this constant.
 */
const LBUG_ALREADY_EXISTS_MSG = 'already exists';
export async function ensureBridgeSchema(handle) {
    const conn = handle._conn;
    for (const q of BRIDGE_SCHEMA_QUERIES) {
        try {
            await conn.query(q);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes(LBUG_ALREADY_EXISTS_MSG))
                throw err;
        }
    }
}
export async function queryBridge(handle, cypher, params) {
    const run = async () => {
        const conn = handle._conn;
        if (params && Object.keys(params).length > 0) {
            const stmt = await conn.prepare(cypher);
            if (!stmt.isSuccess()) {
                const errMsg = await stmt.getErrorMessage();
                throw new Error(`Bridge query prepare failed: ${errMsg}`);
            }
            const queryResult = await conn.execute(stmt, params);
            const result = unwrapQueryResult(queryResult);
            return (await result.getAll());
        }
        const queryResult = await conn.query(cypher);
        const result = unwrapQueryResult(queryResult);
        return (await result.getAll());
    };
    // Cached RO handles are shared across concurrent @group callers, so serialize
    // conn ops per handle (a LadybugDB Connection is not safe for concurrent
    // queries — conn-lock.ts). Uncached/writable handles (the writeBridge temp DB)
    // are single-threaded — they're absent from bridgeEntryByHandle and skip the
    // lock at zero cost.
    const entry = bridgeEntryByHandle.get(handle);
    return entry ? withHandleLock(entry, run) : run();
}
/**
 * LadybugDB's `conn.query` / `conn.execute` can return either a single
 * `QueryResult` (for a single statement) or an array of them (when a
 * multi-statement script is dispatched). We always pass a single statement,
 * so the array form is a wrapper we unwrap here — but an empty top-level
 * array would cause `.getAll()` on `undefined` and crash with a confusing
 * stack. Throwing an explicit error makes a driver-contract regression
 * visible immediately instead of masking it.
 */
function unwrapQueryResult(queryResult) {
    if (Array.isArray(queryResult)) {
        if (queryResult.length === 0) {
            throw new Error('Bridge query returned an empty QueryResult array');
        }
        return queryResult[0];
    }
    return queryResult;
}
/**
 * Release a caller's reference to a bridge handle.
 *
 * - **Cache-owned handle** (returned by `getCachedBridgeReadOnly`): this is the
 *   matching *release* for that acquire — it decrements the lease refcount, it
 *   does NOT close the native handle. The cache owns the lifetime; the handle
 *   closes on explicit `invalidateBridgeCache`, mtime-eviction, or process
 *   shutdown. If the entry was already evicted and this is the last lease, the
 *   deferred native close fires here (exactly once).
 * - **Uncached/writable handle** (e.g. the `writeBridge` temp DB): closes the
 *   native handle for real (CHECKPOINT-flush for writable handles).
 *
 * Contract: before renaming or deleting `bridge.lbug`, call
 * `invalidateBridgeCache` (not this) — `closeBridgeDb` on a cache-owned handle
 * is a lease release, so the file may stay open under other readers.
 */
export async function closeBridgeDb(handle) {
    const entry = bridgeEntryByHandle.get(handle);
    if (!entry) {
        // Uncached or writable handle — close for real.
        await closeBridgeHandle(handle);
        return;
    }
    // Cache-owned handle: release this lease. Close only the evicted handle whose
    // last lease just dropped (deferred-close completion); the live cached handle
    // stays open for reuse.
    if (entry.refs > 0)
        entry.refs--;
    if (entry.evicted && entry.refs <= 0)
        await finalizeBridgeClose(entry);
}
// NOTE: Windows in-process write→read reopen of the SAME bridge.lbug is still a
// known limitation (the writable close's OS file handle is not released before
// the read open races; the existing open-side LBUG_OPEN_RETRY only retries
// lock-pattern errors, not the post-rename sidecar database-id mismatch). The
// bridge's close-then-reopen tests stay Windows-skipped. A close-side
// waitForWindowsHandleRelease + finalizeLbugSidecarsAfterClose probe (mirroring
// safeClose) was tried and did NOT close that gap on Windows CI, so it was
// removed rather than carry latency/duplication for no Windows benefit.
//
// Scope of the RO bridge-handle cache (getCachedBridgeReadOnly): it removes the
// PRODUCTION symptom — a long-lived MCP serve process reopening bridge.lbug on
// every @group call — by keeping one RO handle alive for read→READ reuse.
// It does NOT fix the write→READ reopen: the first @group read right after an
// in-process group_sync is a cache miss → openBridgeDbReadOnly, i.e. the same
// unfixed reopen, so on Windows that first post-sync read still returns null.
// The read-only CHECKPOINT skip above remains the load-bearing fix on
// Linux/macOS.
/* ------------------------------------------------------------------ */
/*  writeBridgeMeta / readBridgeMeta                                  */
/* ------------------------------------------------------------------ */
export async function writeBridgeMeta(groupDir, meta) {
    await writeFileAtomic(path.join(groupDir, 'meta.json'), JSON.stringify(meta, null, 2));
}
export async function readBridgeMeta(groupDir) {
    try {
        const content = await fsp.readFile(path.join(groupDir, 'meta.json'), 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return { version: 0, generatedAt: '', missingRepos: [] };
    }
}
const MAX_SAMPLE_ERRORS = 10;
function errMessage(err) {
    if (err instanceof Error)
        return err.message;
    try {
        return String(err);
    }
    catch {
        return 'unknown error';
    }
}
export async function writeBridge(groupDir, input) {
    await fsp.mkdir(groupDir, { recursive: true });
    // Invalidate the RO cache before writing. On Windows the cached handle
    // would block the atomic rename (tmp → bridge.lbug) because the OS keeps
    // a shared-mode lock on the open file. Closing it first guarantees the
    // rename succeeds without EBUSY.
    await invalidateBridgeCache(groupDir);
    const contracts = dedupeContracts(input.contracts);
    const crossLinks = dedupeCrossLinks(input.crossLinks);
    const finalPath = path.join(groupDir, 'bridge.lbug');
    // Stage the temp database inside a unique mkdtemp directory rather than
    // a fixed `bridge.lbug.tmp` name. The previous shape was flagged by
    // CodeQL js/insecure-temporary-file as a predictable path: a co-located
    // attacker (or a parallel writeBridge call into the same group) could
    // pre-create or symlink that path before this writer opens it. mkdtemp
    // returns a directory whose suffix is filled with cryptographically
    // random bytes, so the staging path is unguessable AND collision-free
    // across parallel callers. We anchor the staging directory inside
    // `groupDir` so the subsequent rename of `bridge.lbug` (and its
    // `.wal` / `.shadow` sidecars) into place stays on the same filesystem
    // and remains atomic — moving across `os.tmpdir()` could trip EXDEV.
    const stagingDir = await fsp.mkdtemp(path.join(groupDir, 'bridge-tmp-'));
    const tmpPath = path.join(stagingDir, 'bridge.lbug');
    const bakPath = path.join(groupDir, 'bridge.lbug.bak');
    const report = {
        contractsInserted: 0,
        contractsFailed: 0,
        snapshotsInserted: 0,
        snapshotsFailed: 0,
        linksInserted: 0,
        linksFailed: 0,
        linksDroppedMissingNode: 0,
        sampleErrors: [],
    };
    const recordError = (kind, id, err) => {
        if (report.sampleErrors.length < MAX_SAMPLE_ERRORS) {
            report.sampleErrors.push({ kind, id, message: errMessage(err) });
        }
    };
    // The mkdtemp staging directory above is freshly created with a unique
    // random suffix, so there are no leftover `bridge.lbug.tmp` / `.wal` /
    // `.shadow` sidecars from a previous crashed run to clean up here — the
    // directory is empty by construction.
    try {
        // 1. Create temp DB, insert all data.
        //
        // Everything after `openBridgeDb` must run inside a try/finally so that
        // if ANY step before the explicit `closeBridgeDb` throws — schema
        // creation, a contract insert loop that rethrows, a snapshot write, the
        // cross-link loop, or anything else — the handle is still released. A
        // leaked handle holds the native LadybugDB file lock on tmpPath, which
        // (a) leaks a FD and (b) prevents the next writeBridge call from
        // reusing the same tmp slot.
        const handle = await openBridgeDb(tmpPath);
        let handleClosed = false;
        try {
            await ensureBridgeSchema(handle);
            // Build the lookup index incrementally as contracts are inserted, so
            // failed inserts are never in the index (and therefore never resolved
            // by the cross-link loop below). This replaces a previous N+1 query
            // pattern where each link made up to 6 DB round-trips to find its
            // endpoints — see ContractLookupIndex.
            const lookupIndex = createContractLookupIndex();
            // Insert contracts — tolerate individual failures (e.g., a corrupt meta
            // that can't be serialized). The whole sync must not fail because one
            // contract is broken.
            for (const c of contracts) {
                const id = contractNodeId(c.repo, c.contractId, c.role, c.symbolRef.filePath);
                try {
                    await queryBridge(handle, `CREATE (n:Contract {
      id: $id,
      contractId: $contractId,
      type: $type,
      role: $role,
      repo: $repo,
      service: $service,
      symbolUid: $symbolUid,
      filePath: $filePath,
      symbolName: $symbolName,
      confidence: $confidence,
      meta: $meta
    })`, {
                        id,
                        contractId: c.contractId,
                        type: c.type,
                        role: c.role,
                        repo: c.repo,
                        service: c.service ?? '',
                        symbolUid: c.symbolUid,
                        filePath: c.symbolRef.filePath,
                        symbolName: c.symbolName,
                        confidence: c.confidence,
                        meta: JSON.stringify(c.meta),
                    });
                    report.contractsInserted++;
                    // Only index on successful insert — the cross-link loop must never
                    // resolve to a row that isn't actually in the DB.
                    indexContract(lookupIndex, c, id);
                }
                catch (err) {
                    report.contractsFailed++;
                    recordError('contract', id, err);
                }
            }
            // Insert repo snapshots
            for (const [repoId, snap] of Object.entries(input.repoSnapshots)) {
                try {
                    await queryBridge(handle, `CREATE (s:RepoSnapshot {
      id: $id,
      indexedAt: $indexedAt,
      lastCommit: $lastCommit
    })`, {
                        id: repoId,
                        indexedAt: snap.indexedAt,
                        lastCommit: snap.lastCommit,
                    });
                    report.snapshotsInserted++;
                }
                catch (err) {
                    report.snapshotsFailed++;
                    recordError('snapshot', repoId, err);
                }
            }
            // Insert cross-links (tolerating missing nodes).
            //
            // `findContractNode` consults the in-memory lookup index built above,
            // not the DB — that's an O(1) pure-function lookup per endpoint instead
            // of the previous 2-3 DB queries. For M cross-links, the previous code
            // issued up to 6M round-trips; this version issues zero.
            //
            // `link.contractId` may differ between the consumer and provider sides
            // (e.g. wildcard consumer `grpc::Service/*` → method-level provider
            // `grpc::Service/Method`) — that's why we resolve each endpoint
            // independently via its own `(repo, role, symbolUid, filePath, symbolName)`
            // tuple rather than matching on contractId.
            for (const link of crossLinks) {
                const linkId = `${link.from.repo}::${link.contractId}->${link.to.repo}::${link.contractId}`;
                try {
                    const fromId = findContractNode(lookupIndex, link.from.repo, 'consumer', link.from.symbolUid, link.from.symbolRef.filePath, link.from.symbolRef.name);
                    const toId = findContractNode(lookupIndex, link.to.repo, 'provider', link.to.symbolUid, link.to.symbolRef.filePath, link.to.symbolRef.name);
                    if (!fromId || !toId) {
                        report.linksDroppedMissingNode++;
                        continue;
                    }
                    await queryBridge(handle, `
      MATCH (a:Contract), (b:Contract)
      WHERE a.id = $fromId AND b.id = $toId
      CREATE (a)-[:ContractLink {
        matchType: $matchType,
        confidence: $confidence,
        contractId: $contractId,
        fromRepo: $fromRepo,
        toRepo: $toRepo
      }]->(b)
    `, {
                        fromId,
                        toId,
                        matchType: link.matchType,
                        confidence: link.confidence,
                        contractId: link.contractId,
                        fromRepo: link.from.repo,
                        toRepo: link.to.repo,
                    });
                    report.linksInserted++;
                }
                catch (err) {
                    report.linksFailed++;
                    recordError('link', linkId, err);
                }
            }
            // 2. Close temp DB (happy path). The finally block also calls
            //    closeBridgeDb if we threw above; `handleClosed` prevents a
            //    double-close on the native handle.
            await closeBridgeDb(handle);
            handleClosed = true;
        }
        finally {
            if (!handleClosed) {
                await closeBridgeDb(handle).catch(() => {
                    /* ignore: cleanup path, best effort */
                });
            }
        }
        // 3. Atomic swap: old→.bak, tmp→final, rm .bak
        //
        // The current database file (with its `.wal` / `.shadow` sidecars) is
        // moved aside, then the freshly built tmp database takes its place.
        // We move the sidecars together with the main file so the open below
        // and any external readers see a consistent set; orphan sidecars from
        // the tmp namespace are then removed because LadybugDB looks for them
        // under the renamed-to base name and would reject mismatching IDs.
        try {
            await fsp.access(finalPath);
            await retryRename(finalPath, bakPath);
            for (const suffix of LBUG_SIDECAR_SUFFIXES) {
                try {
                    await fsp.access(`${finalPath}${suffix}`);
                    await retryRename(`${finalPath}${suffix}`, `${bakPath}${suffix}`);
                }
                catch {
                    /* sidecar absent — nothing to move */
                }
            }
        }
        catch {
            /* no existing db */
        }
        await retryRename(tmpPath, finalPath);
        for (const suffix of LBUG_SIDECAR_SUFFIXES) {
            // Rename — not delete — so the WAL (which may carry uncommitted-at-
            // close-time pages on a graceful close, depending on
            // `autoCheckpoint` / `checkpointThreshold`) and the `.shadow`
            // checkpoint snapshot stay paired with the database file under its
            // final name. LadybugDB 0.16.0's database-id check rejects an open
            // when the sidecars belong to a different base name.
            try {
                await fsp.access(`${tmpPath}${suffix}`);
                await retryRename(`${tmpPath}${suffix}`, `${finalPath}${suffix}`);
            }
            catch {
                /* sidecar absent — nothing to move */
            }
        }
        await removeLbugFile(bakPath);
        // 4. Write meta.json
        await writeBridgeMeta(groupDir, {
            version: BRIDGE_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            missingRepos: input.missingRepos,
        });
        return report;
    }
    finally {
        // Always remove the mkdtemp staging directory. On the happy path the
        // main file and sidecars have been renamed out of it, so it's empty;
        // on any error path it may still contain a partial database — either
        // way `recursive: true, force: true` removes it without surfacing
        // "directory not empty" or ENOENT.
        await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {
            /* best-effort cleanup */
        });
    }
}
/* ------------------------------------------------------------------ */
/*  openBridgeDbReadOnly                                               */
/* ------------------------------------------------------------------ */
/**
 * Substrings observed in the message of an `Error` raised by the LadybugDB
 * native open path when Windows still holds an exclusive lock on the file
 * after a writer's `Database.close()` returned. LadybugDB 0.16.0's
 * non-blocking checkpoint thread can briefly outlive the close call, so a
 * read-side opener that races in immediately afterwards sees Win32 error
 * 33 ("The process cannot access the file because another process has
 * locked a portion of the file"). Retrying with a small back-off lets the
 * background thread settle and the OS release the handle.
 *
 * As of v0.18.0 the "Could not set lock" file-lock error text gained an
 * appended detail suffix upstream (see `lbug-config.ts`'s
 * `OPEN_LOCK_RETRY_ATTEMPTS` comment), but the substrings matched here are
 * unaffected by that change.
 */
const LBUG_OPEN_RETRY_PATTERNS = [
    'process cannot access the file',
    'another process has locked',
    'could not set lock',
    'lock held by another process',
];
// Cross-repo bridge RO open retry. Catalogued as entry 5 of the lbug-config
// retry-budget registry; caps back-off so total wait ~3s.
const LBUG_OPEN_RETRY_ATTEMPTS = 10;
const LBUG_OPEN_RETRY_BASE_MS = 100;
/** Cap individual back-off delays so the total wait is bounded (~3s). */
const LBUG_OPEN_RETRY_MAX_MS = 500;
function isTransientLockError(err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return LBUG_OPEN_RETRY_PATTERNS.some((p) => msg.includes(p));
}
async function ensureBridgeDbFileAvailable(groupDir) {
    const dbPath = path.join(groupDir, 'bridge.lbug');
    try {
        await fsp.access(dbPath);
        return true;
    }
    catch {
        // Check for .bak recovery. Use `retryRename` (not `fsp.rename`) for the
        // exact same reason the rest of this file does: the scenario that
        // triggers bak recovery is an interrupted writer, which on Windows may
        // still be holding an open handle on `.bak` for a few milliseconds when
        // a reader races in. EBUSY/EPERM retries recover that case silently.
        const bakPath = path.join(groupDir, 'bridge.lbug.bak');
        try {
            await fsp.access(bakPath);
            await retryRename(bakPath, dbPath);
            for (const suffix of LBUG_SIDECAR_SUFFIXES) {
                try {
                    await fsp.access(`${bakPath}${suffix}`);
                    await retryRename(`${bakPath}${suffix}`, `${dbPath}${suffix}`);
                }
                catch {
                    /* sidecar absent */
                }
            }
            return true;
        }
        catch {
            return false;
        }
    }
}
export async function openBridgeDbReadOnly(groupDir) {
    const dbPath = path.join(groupDir, 'bridge.lbug');
    if (!(await ensureBridgeDbFileAvailable(groupDir)))
        return null;
    // Version gate: check meta.json version compatibility
    const meta = await readBridgeMeta(groupDir);
    if (meta.version > 0 && meta.version !== BRIDGE_SCHEMA_VERSION) {
        return null; // incompatible schema version — fallback to JSON or re-sync
    }
    // Open the native handle with a bounded retry on transient OS-level file
    // locks (see LBUG_OPEN_RETRY_PATTERNS). If Connection construction throws
    // AFTER Database was successfully allocated, we'd leak the native Database
    // object — wrap each step separately and tear down the partial handle.
    let lastErr;
    for (let attempt = 1; attempt <= LBUG_OPEN_RETRY_ATTEMPTS; attempt++) {
        let handle;
        try {
            handle = await openLbugConnection(lbug, dbPath, { readOnly: true });
            // Force the lazy native init now so a transient lock surfaces here
            // (where we can retry) instead of on the first user query.
            await handle.db.init();
            await handle.conn.init();
            return {
                _db: handle.db,
                _conn: handle.conn,
                groupDir,
                _readOnly: true,
            };
        }
        catch (err) {
            lastErr = err;
            if (handle)
                await closeLbugConnection(handle);
            if (!isTransientLockError(err) || attempt === LBUG_OPEN_RETRY_ATTEMPTS)
                break;
            const delay = Math.min(LBUG_OPEN_RETRY_BASE_MS * attempt, LBUG_OPEN_RETRY_MAX_MS);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    // Strip CRLF from user-controlled strings before logging to close
    // CodeQL js/log-injection. Pino's NDJSON serialization already
    // JSON-escapes all values, but we sanitize here as a defence-in-depth
    // measure so CodeQL can see the taint flow is broken.
    const safeGroupDir = String(groupDir).replace(/[\r\n]/g, ' ');
    const safeErrMsg = lastErr instanceof Error ? String(lastErr.message).replace(/[\r\n]/g, ' ') : undefined;
    bridgeLogger.debug({
        groupDir: safeGroupDir,
        errMsg: safeErrMsg,
        attempts: LBUG_OPEN_RETRY_ATTEMPTS,
    }, 'openBridgeDbReadOnly gave up');
    return null;
}
/* ------------------------------------------------------------------ */
/*  bridgeExists                                                       */
/* ------------------------------------------------------------------ */
export async function bridgeExists(groupDir) {
    if (!(await ensureBridgeDbFileAvailable(groupDir)))
        return false;
    const meta = await readBridgeMeta(groupDir);
    return meta.version === 0 || meta.version === BRIDGE_SCHEMA_VERSION;
}
