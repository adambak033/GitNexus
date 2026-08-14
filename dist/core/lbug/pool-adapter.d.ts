/**
 * LadybugDB connection pool (core). Used by MCP, sync, search, wiki, etc.
 *
 * LadybugDB Adapter (Connection Pool)
 *
 * Manages a pool of LadybugDB databases keyed by repoId, each with
 * multiple Connection objects for safe concurrent query execution.
 *
 * LadybugDB Connections are NOT thread-safe — a single Connection
 * segfaults if concurrent .query() calls hit it simultaneously.
 * This adapter provides a checkout/return connection pool so each
 * concurrent query gets its own Connection from the same Database.
 *
 * @see https://docs.ladybugdb.com/concurrency — multiple Connections
 * from the same Database is the officially supported concurrency pattern.
 */
import lbug from '@ladybugdb/core';
/** Filesystem identity used to detect an index rebuilt/mutated under a live
 *  read pool. `ino` catches a full-rebuild unlink+recreate or an atomic-rename
 *  swap; `mtimeMs`+`size` catch an in-place incremental writeback. */
interface DbIdentity {
    ino: number;
    mtimeMs: number;
    size: number;
}
export declare function statDbIdentity(dbPath: string): Promise<DbIdentity | null>;
/** True only when both identities are known AND differ. A stat failure
 *  (ENOENT during the brief unlink window of a full rebuild) yields false, so
 *  the reader keeps serving its still-valid open inode until the NEW file
 *  appears with a different identity — avoiding a churn into a failed reopen
 *  mid-rebuild. */
export declare function dbIdentityChanged(prev: DbIdentity | null, next: DbIdentity | null): boolean;
/**
 * Listeners notified when a pool entry is torn down (LRU eviction, idle
 * timeout, explicit close). Used by upper layers (e.g. the BM25 search
 * module) to invalidate per-repo caches that must not outlive the pool
 * entry that produced them.
 *
 * Listeners run synchronously inside `closeOne` after the pool entry has
 * been removed; throwing listeners are isolated so one bad listener does
 * not prevent others from firing or break teardown.
 */
type PoolCloseListener = (repoId: string) => void;
/**
 * Subscribe to pool-close events. Returns a disposer that removes the
 * listener (handy for tests).
 */
export declare function addPoolCloseListener(listener: PoolCloseListener): () => void;
export { realStdoutWrite, realStderrWrite, setActiveStdoutWrite } from '../../mcp/stdio-capture.js';
/**
 * Touch a repo to reset its idle timeout.
 * Call this during long-running operations to prevent the connection from being closed.
 */
export declare const touchRepo: (repoId: string) => void;
/**
 * Acquire one eviction-exemption lease on a repo (LRU + idle timeout) by
 * incrementing its reference count. The repoId must match the key passed to
 * initLbug (e.g. group sync leases by handle.id — the same id it inits with).
 * Leasing a repoId before it enters the pool is allowed and protects the entry
 * once it is created, but the lease does NOT survive a teardown: closeOne
 * force-clears the count, so a later re-init of the same repoId starts
 * unpinned. Each pinRepo MUST be balanced by exactly one release (the repo
 * stays exempt until the last lease is released). See the pinnedRepos docstring
 * for the full contract.
 *
 * Returns a `release` disposer (mirroring addPoolCloseListener) that releases
 * THIS lease exactly once — calling it twice is a no-op, so it can never
 * over-decrement a sibling holder's count. Prefer the disposer
 * (`const release = pinRepo(id); try { … } finally { release(); }`) so the
 * pin/release pair is leak-proof; unpinRepo remains available for callers that
 * pair explicitly.
 */
export declare const pinRepo: (repoId: string) => (() => void);
/**
 * Release one eviction-exemption lease on a repo. The repo becomes eligible for
 * automatic eviction again only once its count reaches 0 (the key is deleted).
 * Idempotent at the floor: releasing a repo with no active lease is a no-op (no
 * negative counts). Does NOT close the repo's pool.
 */
export declare const unpinRepo: (repoId: string) => void;
/**
 * Maximum number of repos a bounded multi-repo operation (e.g. group sync's
 * windowed manifest resolution) should hold resident at once. Equals
 * MAX_POOL_SIZE today, but exposed under an intent-named accessor so callers
 * size their working set against "max repos a bounded op should hold" rather
 * than coupling to the LRU eviction-cap constant, which may be tuned
 * independently.
 */
export declare const getMaxResidentRepos: () => number;
/**
 * Silence stdout by replacing process.stdout.write with a no-op.
 * Uses a reference counter so nested silence/restore pairs are safe.
 * Exported so other modules (e.g. embedder) use the same mechanism instead
 * of independently patching stdout, which causes restore-order conflicts.
 */
export declare function silenceStdout(): void;
export declare function restoreStdout(): void;
/**
 * Initialize (or reuse) a Database + connection pool for a specific repo.
 * Retries on lock errors (e.g., when `gitnexus analyze` is running).
 *
 * Concurrent calls for the same repoId are deduplicated — the second caller
 * awaits the first's in-progress init rather than starting a redundant one.
 */
/**
 * Returns `true` when this call (re)opened a fresh handle onto the current
 * on-disk file, `false` when it reused/served the existing handle (unchanged,
 * or changed-but-a-query-is-in-flight). Callers that gate their own freshness
 * bookkeeping on "did the pool actually roll over" (LocalBackend) use the
 * return value; callers that only need the pool ready can ignore it.
 */
export declare const initLbug: (repoId: string, dbPath: string) => Promise<boolean>;
/**
 * Initialize a pool entry from a pre-existing Database object.
 *
 * Used in tests to avoid the writable→close→read-only cycle that crashes
 * on macOS due to N-API destructor segfaults.  The pool adapter reuses
 * the core adapter's writable Database instead of opening a new read-only one.
 *
 * The Database is registered in the shared dbCache so closeOne() decrements
 * the refCount correctly.  If the Database is already cached (e.g. another
 * repoId already injected it), the existing entry is reused.
 */
export declare function initLbugWithDb(repoId: string, existingDb: lbug.Database, dbPath: string): Promise<void>;
export declare const executeQuery: (repoId: string, cypher: string) => Promise<any[]>;
/**
 * Execute a parameterized query on a specific repo's connection pool.
 * Uses prepare/execute pattern to prevent Cypher injection.
 */
export declare const executeParameterized: (repoId: string, cypher: string, params: Record<string, any>) => Promise<any[]>;
/**
 * Close one or all repo pools.
 * If repoId is provided, close only that repo's connections.
 * If omitted, close all repos.
 */
export declare const closeLbug: (repoId?: string) => Promise<void>;
/**
 * Check if a specific repo's pool is active
 */
export declare const isLbugReady: (repoId: string) => boolean;
