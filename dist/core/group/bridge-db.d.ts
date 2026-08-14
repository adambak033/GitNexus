import type { LbugValue } from '@ladybugdb/core';
import type { BridgeHandle, BridgeMeta, StoredContract, CrossLink, RepoSnapshot } from './types.js';
/**
 * Serialize an operation on a cached handle's per-handle FIFO chain. Mirrors the
 * promise-chain mechanic of `lbug/conn-lock.ts` (install a fresh unresolved
 * tail, await the prior holder, release in `finally` so a throw never wedges the
 * chain) — but keyed per handle, not a single global lock. No re-entry guard:
 * `queryBridge` is a leaf (it never calls another locked bridge helper), and the
 * native close runs outside the lock gated on `refs === 0`.
 */
export declare function withHandleLock<T>(lock: {
    lockTail: Promise<void>;
}, fn: () => Promise<T>): Promise<T>;
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
export declare function getCachedBridgeReadOnly(groupDir: string): Promise<BridgeHandle | null>;
/**
 * Invalidate the cached read-only handle for `groupDir`. Drops it from the
 * cache immediately; the native close is deferred until any in-flight reader
 * leases drain (see {@link evictBridgeEntry}). With no concurrent reader this
 * resolves only after the handle is actually closed — which is why
 * `writeBridge` awaits it before its atomic rename (Windows: a still-open RO
 * handle would block the rename with EBUSY).
 */
export declare function invalidateBridgeCache(groupDir: string): Promise<void>;
/**
 * Close ALL cached bridge handles. Call on process shutdown only — it force-
 * closes regardless of refs (safe at `beforeExit`, which fires only at
 * event-loop quiescence, so no query is in flight). Do NOT wire this to a
 * SIGTERM/SIGINT handler that can fire mid-request: that would close a handle
 * under a live query. Routes through `finalizeBridgeClose` for the close-once
 * guarantee.
 */
export declare function closeAllCachedBridges(): Promise<void>;
export declare function contractNodeId(repo: string, contractId: string, role: string, filePath: string): string;
/**
 * In-memory index of contract node IDs keyed three ways, mirroring the
 * three-tier fallback lookup in {@link findContractNode}. Built once per
 * `writeBridge` call after all contracts are successfully inserted, then
 * consulted for every cross-link — which eliminates the former N+1 query
 * pattern (up to `6 × cross-links` DB round-trips) and turns cross-link
 * resolution into constant-time per link.
 *
 * Keys are deliberately flat strings (not tuples) so `Map<string, ...>`
 * works; the separator `\0` can't occur in any legal repo path / file
 * path / symbol identifier, which makes the encoding injection-safe.
 */
export interface ContractLookupIndex {
    /** tier 1: `repo + role + symbolUid` → contract node id */
    byUid: Map<string, string>;
    /** tier 2: `repo + role + filePath + symbolName` → contract node id */
    byRef: Map<string, string>;
    /** tier 3: `repo + role + filePath` → list of contract node ids in that file */
    byFile: Map<string, string[]>;
}
export declare function createContractLookupIndex(): ContractLookupIndex;
/**
 * Add a successfully-inserted contract to the lookup index. Must be called
 * AFTER the DB insert succeeds (not before) so failed inserts don't poison
 * the index and cause cross-links to point at non-existent rows.
 */
export declare function indexContract(index: ContractLookupIndex, contract: StoredContract, nodeId: string): void;
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
export declare function findContractNode(index: ContractLookupIndex, repo: string, role: 'consumer' | 'provider', symbolUid: string, filePath: string, symbolName: string): string | null;
export declare function openBridgeDb(dbPath: string): Promise<BridgeHandle>;
export declare function ensureBridgeSchema(handle: BridgeHandle): Promise<void>;
export declare function queryBridge<T>(handle: BridgeHandle, cypher: string, params?: Record<string, LbugValue>): Promise<T[]>;
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
export declare function closeBridgeDb(handle: BridgeHandle): Promise<void>;
export declare function writeBridgeMeta(groupDir: string, meta: BridgeMeta): Promise<void>;
export declare function readBridgeMeta(groupDir: string): Promise<BridgeMeta>;
export interface WriteBridgeInput {
    contracts: StoredContract[];
    crossLinks: CrossLink[];
    repoSnapshots: Record<string, RepoSnapshot>;
    missingRepos: string[];
}
/**
 * Non-fatal issues encountered during writeBridge. Callers can log these to
 * surface partial-success state without aborting the whole sync.
 * `sampleErrors` is capped at MAX_SAMPLE_ERRORS per category to bound memory.
 */
export interface WriteBridgeReport {
    contractsInserted: number;
    contractsFailed: number;
    snapshotsInserted: number;
    snapshotsFailed: number;
    linksInserted: number;
    linksFailed: number;
    /** Cross-links skipped because their from/to contract nodes weren't found. */
    linksDroppedMissingNode: number;
    sampleErrors: Array<{
        kind: 'contract' | 'snapshot' | 'link';
        id: string;
        message: string;
    }>;
}
export declare function writeBridge(groupDir: string, input: WriteBridgeInput): Promise<WriteBridgeReport>;
export declare function openBridgeDbReadOnly(groupDir: string): Promise<BridgeHandle | null>;
export declare function bridgeExists(groupDir: string): Promise<boolean>;
