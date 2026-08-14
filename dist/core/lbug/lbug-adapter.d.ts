import lbug from '@ladybugdb/core';
import { KnowledgeGraph } from '../graph/types.js';
import { NodeTableName } from './schema.js';
import type { GraphEmitManifest } from './graph-emit-sink.js';
import type { PdgEmitManifest } from './pdg-emit-sink.js';
import { type CachedEmbedding } from '../embeddings/types.js';
import { type ExtensionEnsureOptions } from './extension-loader.js';
/** Result of splitting the relationship CSV into per-label-pair files. */
export interface RelCsvSplitResult {
    relHeader: string;
    relsByPairMeta: Map<string, {
        csvPath: string;
        rows: number;
    }>;
    pairWriteStreams: Map<string, import('fs').WriteStream>;
    skippedRels: number;
    totalValidRels: number;
}
/** Expose the current Database for pool adapter reuse in tests. */
export declare const getDatabase: () => lbug.Database | null;
/**
 * Return true when the error message indicates a write was attempted against
 * a read-only LadybugDB connection. The MCP query pool opens DBs read-only,
 * so any path that calls a `CREATE_*` procedure there will surface this
 * (e.g. defensive `ensureFTSIndex` calls). Owners of the writable analyze
 * path should ignore this error — index creation is owned by `gitnexus
 * analyze` and either already happened or will happen on the next run.
 */
export declare const isReadOnlyDbError: (err: unknown) => boolean;
/**
 * Acquire a cross-process init lock for `dbPath`.
 * Uses `O_CREAT | O_EXCL` for atomic create-or-fail semantics.
 *
 * Returns a release function that removes the lock file. The release
 * function is idempotent and safe to call even if the lock was already
 * cleaned up externally.
 *
 * Throws if the lock cannot be acquired after `INIT_LOCK_MAX_ATTEMPTS`.
 */
export declare const acquireInitLock: (dbPath: string) => Promise<() => Promise<void>>;
/** Exported for testing — returns the lock file path for a given dbPath. */
export declare const _initLockPathForTest: (dbPath: string) => string;
export declare const initLbug: (dbPath: string) => Promise<{
    db: lbug.Database;
    conn: lbug.Connection;
}>;
/**
 * Execute multiple queries against one repo DB atomically.
 * While the callback runs, no other request can switch the active DB.
 *
 * Automatically retries up to DB_LOCK_RETRY_ATTEMPTS times when the
 * database is busy (e.g. `gitnexus analyze` holds the write lock).
 * Each retry waits DB_LOCK_RETRY_DELAY_MS * attempt milliseconds.
 */
export declare const withLbugDb: <T>(dbPath: string, operation: () => Promise<T>, options?: {
    readOnly?: boolean;
}) => Promise<T>;
export type LbugProgressCallback = (message: string) => void;
/**
 * A staging CSV named in the COPY manifest is gone by the time COPY runs.
 *
 * Only tables with `rows > 0` enter the manifest (see `csv-generator.ts`), so
 * the file WAS written during this run and something removed it since. Raw,
 * that surfaces as a LadybugDB "Binder exception: No file found that matches
 * the pattern …" and then an ENOENT on the next file — two engine-level
 * messages that name neither the cause nor a remedy, and which the field
 * reports show operators hitting on a forced rebuild with nothing to act on.
 */
export declare const missingStagingCsvError: (table: string, csvPath: string, rows: number) => Error;
/**
 * Persist a KnowledgeGraph: stream CSVs, then bulk-COPY nodes (overlapped with
 * relationship emit — see the body) and relationships.
 *
 * NOT TRANSACTIONAL (#2226). Each `COPY` commits independently and there is no
 * surrounding transaction, so a failure partway through — a node `COPY` that
 * throws at the FK barrier, a relationship `COPY` failure, or a `pdgEmitManifest`
 * collision raised after node rows have already committed in the overlap path —
 * leaves a partially-loaded DB. The caller surfaces the error; recovery is a
 * `--force` re-analyze (a full rebuild), not a partial retry. Callers must not
 * assume the DB is either fully loaded or untouched after a rejection.
 */
export declare const loadGraphToLbug: (graph: KnowledgeGraph, repoPath: string, storagePath: string, onProgress?: LbugProgressCallback, 
/**
 * Streamed PDG-emit manifest (#2202). When present (streaming was on, full
 * rebuild), the BasicBlock node CSV + per-pair PDG-edge CSVs it points at
 * were already flushed to disk during the emit loop; they are merged into the
 * COPY plan below so they load alongside the structural CSVs. When streaming
 * was on the in-memory `graph` holds zero BasicBlocks, so `streamAllCSVsToDisk`
 * emits none — the manifest is the sole source and there is no double-COPY.
 */
pdgEmitManifest?: PdgEmitManifest, 
/**
 * Streamed structural-emit manifest (#2680). Unlike {@link pdgEmitManifest},
 * these pair keys are NOT disjoint from the whole-graph emit's: a streamed
 * `CALLS` edge is `Function|Function`, exactly like the retained edges
 * `streamAllCSVsToDisk` just wrote. So these files are APPENDED as additional
 * COPY jobs for the same pair rather than merged into `relsByPair` (a Map,
 * which holds one CSV per pair and would silently drop one of them).
 */
graphEmitManifest?: GraphEmitManifest) => Promise<{
    success: boolean;
    insertedRels: number;
    skippedRels: number;
    warnings: string[];
}>;
export declare const COPY_CSV_OPTS = "(HEADER=true, ESCAPE='\"', DELIM=',', QUOTE='\"', PARALLEL=false, auto_detect=false)";
/**
 * Fallback: insert relationships one-by-one if COPY fails.
 *
 * Exported for the quoted-id round-trip tests in
 * `test/integration/lbug-core-adapter.test.ts` (the `DELETE_FILES_CHUNK_SIZE`
 * exported-for-tests precedent); production callers stay in this module.
 * Bails silently when the adapter singleton is closed.
 *
 * KNOWN PRE-EXISTING NARROWING (distinct from the `''` escaping bug, NOT
 * fixed here): the row regex below matches CSV fields with `[^"]*`, so an id
 * containing a double quote (CSV-escaped as `""`) never matches and the edge
 * is skipped. Tracked as part of the quote-in-id divergence documented in
 * `rel-pair-routing.ts`.
 */
export declare const fallbackRelationshipInserts: (validRelLines: string[], validTables: Set<string>, getNodeLabel: (id: string) => string) => Promise<void>;
export declare const getCopyQuery: (table: NodeTableName, filePath: string) => string;
/**
 * Insert a single node to LadybugDB
 * @param label - Node type (File, Function, Class, etc.)
 * @param properties - Node properties
 * @param dbPath - Path to LadybugDB database (optional if already initialized)
 */
export declare const insertNodeToLbug: (label: string, properties: Record<string, any>, dbPath?: string) => Promise<boolean>;
/**
 * Batch insert multiple nodes to LadybugDB using a single connection
 * @param nodes - Array of {label, properties} to insert
 * @param dbPath - Path to LadybugDB database
 * @returns Object with success count and error count
 */
export declare const batchInsertNodesToLbug: (nodes: Array<{
    label: string;
    properties: Record<string, any>;
}>, dbPath: string) => Promise<{
    inserted: number;
    failed: number;
}>;
export declare const executeQuery: (cypher: string) => Promise<any[]>;
export declare const streamQuery: (cypher: string, onRow: (row: any) => void | Promise<void>) => Promise<number>;
/**
 * Execute a single parameterized query (prepare/execute pattern).
 * Prevents Cypher injection by binding values as parameters.
 */
export declare const executePrepared: (cypher: string, params: Record<string, any>) => Promise<any[]>;
export declare const executeWithReusedStatement: (cypher: string, paramsList: Array<Record<string, any>>) => Promise<void>;
/**
 * Node and edge totals for the open index.
 *
 * `edges` is `undefined` when the count could NOT BE TAKEN, and that is a
 * different fact from zero. It used to be initialised to 0 with the query in a
 * swallowing `catch`, so a WAL/lock contention throw during finalize — a
 * documented hazard on this exact call — returned a measured-looking 0. The
 * collapse check downstream then read a perfectly healthy index as a total
 * write collapse, which is precisely the confident-zero failure that check
 * exists to prevent.
 */
export declare const getLbugStats: () => Promise<{
    nodes: number;
    edges: number | undefined;
    /**
     * Edges EXCLUDING the streamed PDG layers, or `undefined` when the count could
     * not be taken (same distinction `edges` makes — an unmeasurable count is not
     * a measured zero).
     *
     * The graph-write-collapse check compares what the pipeline produced against
     * what the database holds, and `edges` counts every `CodeRelation` row — PDG
     * writes into that same table. On a `--pdg` run the expected side is
     * structural-only, so comparing it against the total let PDG volume mask
     * structural loss outright: 1,000 structural edges expected, 4,000 PDG rows
     * persisted, every structural edge gone, and the ratio still clears. This is
     * the like-for-like counterpart.
     */
    structuralEdges: number | undefined;
    /**
     * Why `structuralEdges` is absent, when it is; `undefined` once the count was
     * taken. Recorded rather than swallowed because this query is NEWER and
     * NARROWER than `edges` — it filters on `r.type` with an `IN` predicate — and
     * the collapse check consults only it, so a throw here disables the guard and
     * (since the guard is now also the automatic-rebuild trigger) the repair it
     * drives. A caller that cannot see the difference between "measured" and
     * "could not measure" has no way to say so in its log or its metadata.
     */
    structuralEdgesError?: string;
}>;
/**
 * Load cached embeddings from LadybugDB before a rebuild.
 * Returns all embedding vectors so they can be re-inserted after the graph is reloaded,
 * avoiding expensive re-embedding of unchanged nodes.
 *
 * Detects old schema (no chunkIndex column) and returns empty cache to trigger rebuild.
 */
export declare const loadCachedEmbeddings: () => Promise<{
    embeddingNodeIds: Set<string>;
    embeddings: CachedEmbedding[];
}>;
/**
 * Fetch existing embedding hashes from CodeEmbedding table for incremental embedding.
 * Returns a Map<nodeId, contentHash> suitable for passing to `runEmbeddingPipeline`.
 * Handles legacy DBs without the `contentHash` column (all rows treated as stale with empty hash).
 * Returns undefined if the CodeEmbedding table does not exist.
 *
 * @param execQuery - Cypher query executor (typically pool-adapter's `executeQuery`)
 */
export declare const fetchExistingEmbeddingHashes: (execQuery: (cypher: string) => Promise<any[]>) => Promise<Map<string, string> | undefined>;
/**
 * Flush the WAL so all pending writes are visible to subsequent readers.
 *
 * Best-effort: swallows errors from older LadybugDB versions or schemaless
 * databases that do not support the CHECKPOINT command.  A no-op when there
 * is nothing pending, so safe (and cheap) to call unconditionally after any
 * write path.
 *
 * Use this instead of safeClose when the connection must stay open
 * (e.g. the /api/embed handler that keeps serving queries after flushing).
 *
 * @see safeClose — CHECKPOINT + connection/database close
 */
export declare const flushWAL: () => Promise<void>;
/**
 * Issue a manual `CHECKPOINT` against the current connection and surface
 * any engine error to the caller. Unlike {@link flushWAL}, this variant
 * does NOT swallow Ladybug rename/remove IO failures — the manual
 * checkpoint driver (`wal-checkpoint-driver.ts`) relies on the rejection
 * to drive its bounded retry loop. Returns `false` when no connection is
 * open (the caller treats this as a no-op success — there is no WAL to
 * flush). Returns `true` after a successful CHECKPOINT + drain.
 *
 * The split from `flushWAL` is deliberate: every other CHECKPOINT site
 * (server flush, safeClose) is best-effort and prefers a silent skip;
 * the manual driver, by contrast, must observe failures to decide
 * whether to retry.
 */
export declare const tryFlushWAL: () => Promise<boolean>;
/**
 * Flush the WAL and close the connection and database handles.
 *
 * Consolidates the CHECKPOINT + close pattern into a single function so
 * callers never call conn.close() or db.close() directly (#1376).
 * An ESLint no-restricted-syntax rule enforces this — see eslint.config.mjs.
 *
 * @see flushWAL — CHECKPOINT-only (connection stays open)
 * @see closeLbug — safeClose + module state reset (full teardown)
 */
export declare const safeClose: () => Promise<void>;
/**
 * CHECKPOINT for durability, then DELIBERATELY skip the native connection/database
 * teardown. The name encodes the contract — there is no boolean flag to misuse:
 * call this ONLY from a path that guarantees a `process.exit` immediately after
 * (the CLI analyze success/SIGINT paths and the forked worker).
 *
 * LadybugDB's ClientContext/Connection destructor can double-free after large
 * --pdg writes (gdb: `double free or corruption` in ClientContext::~ClientContext
 * via NodeConnection::Close), aborting the process AFTER a fully-written,
 * checkpointed index. flushWAL already persisted the data; process exit reclaims
 * the native handles. We leave the handles referenced and module state intact so a
 * GC finalizer cannot run the same destructor before exit, and any post-analyze
 * read reuses the live connection. Mirrors the pool adapter's fire-and-forget
 * native teardown (pool-adapter.ts) and the ONNX native-cleanup philosophy.
 * Workaround for a LadybugDB engine bug (to be reported upstream).
 *
 * SAFETY: only valid when a process.exit is guaranteed to follow. Long-lived
 * callers (MCP server, tests) leave `skipNativeCloseOnExit` unset, so
 * runFullAnalysis closes for real via {@link closeLbug} — never this.
 */
export declare const closeLbugBeforeExit: () => Promise<void>;
export declare const closeLbug: () => Promise<void>;
/**
 * Thrown by {@link wipeLbugDbFiles} when a data-bearing member of the
 * LadybugDB file family is still present after the bounded
 * remove-and-verify retries (#2409, tri-review 4669518496 P2-4), and by
 * run-analyze's dirty-recovery block when the crashed run's sidecars can
 * neither be parked nor removed (this shipping review, FIX 1 — same lock
 * class, same remediation, and the CLI already renders this type).
 *
 * Classify by TYPE (`err instanceof LbugWipeError`) — the repo norm from
 * #2385 — never by message text. The MESSAGE is nonetheless fully
 * self-contained (headline + blocked paths + remediation) because
 * `gitnexus serve` forwards only `err.message` over worker IPC
 * (analyze-worker-core.ts), so the serve surface has nothing but this
 * string to show the user. The holder framing deliberately covers the
 * own-process case (FIX 2, finder A): the blocking handle is often a
 * lingering one from THIS process's just-closed DB or a transient AV scan
 * — not necessarily another process — so an immediate re-run often
 * succeeds.
 */
export declare class LbugWipeError extends Error {
    /** Paths still present (or unverifiable) after all retries. */
    readonly survivors: readonly string[];
    constructor(survivors: readonly string[], options?: {
        headline?: string;
    });
}
/**
 * Remove the LadybugDB file family and VERIFY each member is really gone.
 *
 * Owns the canonical 4-file family list — `<lbugPath>`, `.wal`, `.shadow`,
 * `.lock` — so run-analyze's two wipe sites (full rebuild + the #2409
 * escalation valve) can never drift apart. `.shadow` is included because a
 * checkpoint-in-flight crash leaves a shadow sidecar, and a stale shadow next
 * to a freshly created DB file is replay poison on the next open (#2409).
 *
 * Verification contract (tri-review 4669518496 P2-4 — the old inline loops
 * swallowed rm failures and let `initLbug` reopen a still-populated DB the
 * run believed it wiped): after `fs.rm({ recursive, force })`, each path is
 * probed and counts as GONE only when the probe rejects with **ENOENT**. A
 * resolving probe, or a rejection in the EPERM/EBUSY/EACCES class (Windows
 * delete-pending / handle-release lag — see HANDLE_RELEASE_LOCK_CODES in
 * lbug-config.ts), or any other code means the path is not verifiably gone:
 * it is retried on the shared handle-release budget
 * (HANDLE_RELEASE_PROBE_ATTEMPTS × linear HANDLE_RELEASE_PROBE_DELAY_MS,
 * lbug-config.ts — the previous private mirror constants were
 * documentation-coupled copies) and then handled by CLASS (this shipping
 * review, FIX 2):
 *
 *   - DATA-BEARING members (`<lbugPath>`, `.wal`, `.shadow`) — a survivor
 *     means the reopen would resurrect rows this run believes wiped: throw
 *     a typed {@link LbugWipeError}.
 *   - `.lock` — contentless: `initLbug` recreates it, and a genuinely held
 *     lock surfaces as initLbug's own lock-busy classification (a better
 *     error than this one). A `.lock`-only survivor (an AV-held
 *     delete-pending handle outlasting the budget previously failed a
 *     perfectly sound rebuild) logs a warning and CONTINUES.
 *
 * Linux unlinked-but-open (name gone, holder keeps the old inode) probes
 * ENOENT and is accepted by design — both production wipe sites run after a
 * real `closeLbug()`.
 *
 * Deliberately OUT of this contract: `cleanupOldKuzuFiles`
 * (repo-manager.ts) sweeps the LEGACY kuzu-era file family during storage
 * migration — different family, best-effort by design; and
 * `sweepStaleSidecars` (lbug-config.ts) is a test-fixture-gated open-retry
 * fallback that must never delete production files. Neither wipes the live
 * DB the run is about to recreate, so neither needs (or may share) the
 * loud-failure contract here.
 */
export declare const wipeLbugDbFiles: (lbugPath: string) => Promise<void>;
export declare const isLbugReady: () => boolean;
/**
 * Delete all nodes (and their relationships) for a specific file from LadybugDB
 * @param filePath - The file path to delete nodes for
 * @param dbPath - Optional path to LadybugDB for per-query connection
 * @returns Object with counts of deleted nodes
 */
export declare const deleteNodesForFile: (filePath: string, dbPath?: string) => Promise<{
    deletedNodes: number;
}>;
/**
 * Chunk size for {@link deleteNodesForFiles}. 200 paths keeps each
 * statement ~13KB (well inside parser limits) while a ~700-file write set
 * still collapses from ~13,000 statements to 124: 31 statements per chunk
 * (1 CodeEmbedding join-delete + 30 filePath-bearing node tables — the
 * 32-table NODE_TABLES roster minus Community/Process) × 4 chunks. The
 * original "~40" claim under-counted the per-chunk statement fan-out
 * (tri-review 4669518496 accuracy sweep).
 */
export declare const DELETE_FILES_CHUNK_SIZE = 200;
/**
 * Batched variant of {@link deleteNodesForFile} for the incremental
 * writeback (#2409). One `DETACH DELETE … WHERE n.filePath IN […]` per
 * node table per chunk of paths, instead of a count + delete per table
 * per FILE. The per-file loop issued ~13,000 single-row write
 * transactions on a ~700-file write set — a WAL-append storm that made
 * the incremental path slower than a full rebuild and is the write
 * pattern behind the native mid-writeback deaths reported in #2409.
 *
 * NO general error swallowing: a zero-match chunk is a no-op success by
 * construction (every node table except Community/Process has a filePath
 * column), so anything thrown here is a real engine failure the caller
 * must see — silently skipping was exactly how #2409 hid its root cause.
 * The single tolerated exception (FIX 4) is the missing-embedding-table
 * binder error on the embedding join-delete: a DB created without
 * EMBEDDING_SCHEMA cannot own embedding rows, so skipping that one
 * statement is sound, while failing would brick every incremental run on
 * such a DB until `--force`. Statement count per chunk is unchanged by the
 * multi-label join: 1 embedding join-delete + 30 node-table deletes = 31
 * (the rejected per-label fallback shape would have been 19 + 30 = 49).
 * Singleton-connection only: the analyze writeback owns the write lock,
 * and `queryAndDrain` routes through `withConnLock` for it (the WAL
 * checkpoint driver is live during this).
 */
export declare const deleteNodesForFiles: (filePaths: readonly string[], options?: {
    onChunk?: (filesDone: number, filesTotal: number) => void;
}) => Promise<void>;
export declare const getEmbeddingTableName: () => string;
/**
 * Return the distinct repo-relative paths of files that import
 * `targetFilePath` according to the IMPORTS edges currently in the
 * DB. Used by the incremental writeback path to expand the
 * "files-to-rewrite" set so that files importing a changed file get
 * their edges (which may have been refined by cross-file resolution)
 * re-emitted, rather than left stale in the DB.
 *
 * The DB query reads the *previous* run's state — pre-pipeline, before
 * any nodes are deleted — so the returned importers are "files that
 * USED TO import the target". That's the right set to invalidate:
 * those are the files whose edges in the DB might no longer match
 * what cross-file resolution produces given the changed file's new
 * exports.
 */
export declare const queryImporters: (targetFilePath: string) => Promise<string[]>;
/**
 * Batched variant of {@link queryImporters} for the incremental importer
 * BFS (#2409): distinct importers of ANY of the target paths, one query per
 * chunk per BFS depth instead of one query per frontier FILE (a ~700-file
 * frontier was ~700 sequential round-trips, each taking the connection lock
 * against the live WAL checkpoint driver — ~5.6s of the writeback measured).
 *
 * Same contract as the singular form: reads the pre-pipeline DB state and
 * swallows per-chunk query failures into a smaller result (correctness
 * degrades on that branch — under-expansion means possibly-stale edges —
 * but the DB stays writable and the writeback proceeds). Unlike the singular
 * form the degradation is not silent (tri-review 4669518496 P2-5): every
 * dropped chunk is logged and reported through `options.onChunkFailure`, so
 * the orchestrator can count it into the #2410 crash diagnostics
 * (`incrementalInProgress.droppedImporterChunks`).
 */
export declare const queryImportersBatch: (targetFilePaths: readonly string[], options?: {
    /**
     * Invoked once per chunk whose IMPORTS query failed and was dropped from
     * the expansion. Observability only — the degrade-don't-fail contract is
     * unchanged (the result just shrinks by the failed chunk's importers).
     */
    onChunkFailure?: (chunkIndex: number, chunkSize: number, err: unknown) => void;
}) => Promise<string[]>;
/**
 * Drop every Community and Process node (and their MEMBER_OF /
 * STEP_IN_PROCESS edges via DETACH DELETE). Used at the start of an
 * incremental run so the communities and processes phases regenerate
 * them from scratch on the merged graph — required for the
 * "Leiden runs on the FULL graph" correctness invariant.
 */
export declare const deleteAllCommunitiesAndProcesses: () => Promise<{
    nodesDeleted: number;
}>;
/**
 * Drop every interprocedural `TAINT_PATH` relationship (#2084 M4 U6). Used at
 * the start of an incremental `--pdg` writeback so the `taintSummaries` phase
 * re-materialises them from scratch on the FULL recomputed graph.
 *
 * TAINT_PATH validity is a WHOLE-PROGRAM property (a flow A→C can be
 * invalidated by a change to an INTERMEDIATE function whose file is neither A
 * nor C). The endpoint-writability extract rule (`extractChangedSubgraph`)
 * cannot see that — an A→C edge between two unchanged files would be skipped
 * and a stale finding would survive. So, exactly like Community/Process, the
 * sound move is delete-all-then-rebuild: cheap because TAINT_PATH is sparse
 * (per-run capped), and the compute side already rebuilds every summary each
 * run. Relationship-level (TAINT_PATH is an edge type, not a node label), so a
 * plain DELETE on the typed CodeRelation rows — endpoints are untouched.
 */
export declare const deleteAllInterprocTaintPaths: () => Promise<{
    edgesDeleted: number;
}>;
/**
 * Drop every `CALL_SUMMARY` relationship (PDG FU-C, U-C3). Used at the start of
 * an incremental `--pdg` writeback so the `callSummaries` phase re-materialises
 * them from scratch on the FULL recomputed graph.
 *
 * Mirrors {@link deleteAllInterprocTaintPaths}: CALL_SUMMARY is a self-loop edge
 * type (not a node label), so a plain DELETE on the typed CodeRelation rows
 * leaves endpoints untouched. `extractChangedSubgraph` re-includes ALL of them
 * from the fresh graph (`isGraphWideRelType`), so delete-all-then-rebuild keeps
 * an unchanged function's summary from being lost.
 */
export declare const deleteAllCallSummaries: () => Promise<{
    edgesDeleted: number;
}>;
/**
 * Drop every `INJECTS` relationship (DI collection injection, #2200). Used at
 * the start of an incremental writeback — UNCONDITIONALLY, unlike the
 * pdg-gated twins above, because the `di` phase runs on every persisting
 * analyze — so the phase re-materialises them from scratch on the FULL
 * recomputed graph.
 *
 * Mirrors {@link deleteAllInterprocTaintPaths}: INJECTS validity is a
 * whole-program property (a change to the interface, or a new/removed
 * implementer, on a THIRD file creates/invalidates edges between two
 * untouched files), so endpoint-writability extraction can't refresh them.
 * `extractChangedSubgraph` re-includes ALL of them from the fresh graph
 * (`isGraphWideRelType`), so delete-all-then-rebuild is the sound move.
 * Relationship-level (INJECTS is an edge type, not a node label), so a plain
 * DELETE on the typed CodeRelation rows — endpoints are untouched.
 */
export declare const deleteAllInjects: () => Promise<{
    edgesDeleted: number;
}>;
/**
 * Drop every Spring AOP `ADVISED_BY` relationship before incremental
 * writeback. Pointcut/annotation resolution is whole-program: adding a type in
 * a third file can shadow a wildcard annotation import or change a wildcard
 * execution match between two otherwise unchanged endpoint files.
 */
export declare const deleteAllAdvisedBy: () => Promise<{
    edgesDeleted: number;
}>;
/** Drop all synthetic Spring AOP evidence nodes before incremental writeback. */
export declare const deleteSpringAopEvidenceNodes: () => Promise<{
    nodesDeleted: number;
}>;
/**
 * Drop Spring-owned auto-configuration `DECLARES` relationships before
 * incremental writeback. `DECLARES` is generic, so exact reason filtering is
 * required: other metadata systems must retain their own declarations.
 */
export declare const deleteSpringAutoConfigurationDeclarations: () => Promise<{
    edgesDeleted: number;
}>;
/**
 * Drop synthetic source-unavailable auto-configuration Class nodes before
 * incremental writeback. The fresh full graph re-emits every still-needed
 * synthetic node; deleting first also removes placeholders that became stale
 * when a real source class appeared.
 */
export declare const deleteSpringAutoConfigurationSyntheticClasses: () => Promise<{
    nodesDeleted: number;
}>;
/**
 * Load the FTS extension on the supplied connection (or the singleton
 * writable connection when none is given).
 *
 * Delegates to the shared `ExtensionManager` so install policy (auto /
 * load-only / never), out-of-process bounded INSTALL, and capability
 * caching are owned in one place. The module-level `ftsLoaded` flag is
 * kept purely as a per-call short-circuit on the singleton writable
 * connection so repeated callers (e.g. createFTSIndex) avoid an extra
 * `LOAD` round-trip per invocation. Pool adapter callers pass
 * `{ policy: 'load-only' }` so query paths never block on a network install.
 */
export declare const loadFTSExtension: (targetConn?: lbug.Connection, opts?: ExtensionEnsureOptions) => Promise<boolean>;
/**
 * Load the VECTOR extension on the supplied connection (or the singleton
 * writable connection when none is given). Returns false when VECTOR is
 * unavailable so semantic search can fall back to exact scan.
 */
export declare const loadVectorExtension: (targetConn?: lbug.Connection, opts?: ExtensionEnsureOptions) => Promise<boolean>;
/**
 * Default stemmer for FTS indexes. Single source so the analyze path
 * (`getSearchFTSStemmer`) and the read-only `createFTSIndex`/`ensureFTSIndex`
 * defaults can never silently diverge.
 */
export declare const DEFAULT_FTS_STEMMER = "porter";
/**
 * Create a full-text search index on a table
 * @param tableName - The node table name (e.g., 'File', 'CodeSymbol')
 * @param indexName - Name for the FTS index
 * @param properties - List of properties to index (e.g., ['name', 'code'])
 * @param stemmer - Stemming algorithm (default: 'porter')
 */
export declare const createFTSIndex: (tableName: string, indexName: string, properties: string[], stemmer?: string) => Promise<void>;
/**
 * Create the HNSW vector index on the CodeEmbedding table.
 *
 * MUST run via `conn.query()` (here through `queryAndDrain`), NOT through the
 * prepared `executeQuery`/`conn.prepare()` path: `CALL CREATE_VECTOR_INDEX(...)`
 * compiles to multiple statements, which LadybugDB cannot prepare — it fails
 * with "Connection Exception: We do not support prepare multiple statements."
 * Routing index creation through `executeQuery` (prepared) is exactly what
 * broke vector-index creation during `analyze` (#2114; the singleton
 * `executeQuery` was switched to the prepared path in #1655 while FTS index
 * creation kept using `conn.query()`, which is why FTS survived and VECTOR did
 * not). Mirrors `createFTSIndex` above.
 *
 * Returns `true` on success (or when the index already exists — idempotent so
 * incremental re-runs don't spuriously downgrade to exact scan), `false` when
 * the VECTOR extension is unavailable or the connection is read-only. Any other
 * failure propagates so the caller can log it.
 */
export declare const createVectorIndex: () => Promise<boolean>;
/**
 * One row of `CALL SHOW_INDEXES()`.
 *
 * Kept EXPORTED although nothing outside this module names it (#2841 review
 * §5.H): it is the element type of {@link readIndexCatalogRows}' and
 * {@link IndexCatalogSnapshot}'s public signatures, and `declaration: true`
 * requires every type reachable from an exported signature to be exported too.
 *
 * LADYBUGDB-CONTRACT: on @ladybugdb/core 0.18.x rows arrive as NAMED records —
 * `table_name`, `index_name`, `index_type`, `property_names`,
 * `extension_loaded`, `index_definition` — and the readers below key on those
 * names plus the literal `'FTS'` / `'HASH'` index-type spellings. Probe-recorded
 * on 0.18.3: `rows[0][0] === undefined`, so the positional fallbacks (`row?.[0]`
 * &c.) the accessors below carry are DEAD on this version. They are deliberately
 * kept rather than deleted (#2841 review §5.H): they cost nothing, and removing
 * the hedge would turn a future return to the unnamed-tuple form older builds
 * used into a silently fail-OPEN read for the VECTOR gate,
 * `ftsIndexPresenceInCatalog` and the `dropSearchFTSIndexes` sweep — the #2841
 * failure class this file exists to close. (`ensureFtsRowDmlSafe` is the one
 * exception: it treats an unreadable type as "might be FTS" and gates, so it
 * fails CLOSED on the tuple form — see its §6.A note. Losing the fallback would
 * cost it precision, not safety.) When bumping LadybugDB, re-validate — `git
 * grep "LADYBUGDB-CONTRACT"` enumerates every version-coupled spot, and the
 * column/position coupling itself is reachable ONLY through the three accessors
 * below, so that enumeration is true by construction rather than by discipline.
 */
export type IndexCatalogRow = Record<string, unknown>;
/**
 * The three field reads every index-catalog consumer needs, each hedging the
 * named-record form against the positional one exactly once.
 *
 * They exist because the hedge used to be inlined at five call sites across two
 * modules (#2841 review), one of which — the `dropSearchFTSIndexes` sweep in
 * `core/search/fts-indexes.ts` — carried no LADYBUGDB-CONTRACT marker at all, so
 * the doc above claimed a grep that could not find it. Exported for that module;
 * everything version-coupled about the row shape now lives in this one block.
 */
export declare const indexRowTable: (row: IndexCatalogRow | undefined) => unknown;
export declare const indexRowName: (row: IndexCatalogRow | undefined) => unknown;
export declare const indexRowType: (row: IndexCatalogRow | undefined) => unknown;
/**
 * Read the index catalog on the writable connection, or `undefined` when it
 * cannot be read.
 *
 * `SHOW_INDEXES` is readable WITHOUT any extension loaded and reports
 * `extension_loaded` per index, so the extension-gated-DML checks below settle
 * the common "this DB carries no such index" case with one local read and no
 * error-string sniffing. It runs through the unprepared `conn.query()` path
 * like every other `CALL` procedure here (#2114).
 *
 * `undefined` means "could not prove anything" and every caller must treat it
 * as fail-closed (assume an index may be present), never as "no indexes". All
 * three readers below honour that, `ftsIndexExistsInCatalog` included since
 * #2841 review H3. To hand ONE read to several gates, use
 * {@link readIndexCatalogSnapshot} — passing this `undefined` on cannot be
 * distinguished from passing nothing at all.
 */
export declare const readIndexCatalogRows: () => Promise<IndexCatalogRow[] | undefined>;
/**
 * The failed half of an {@link IndexCatalogSnapshot}: the caller DID read the
 * catalog and could not prove anything.
 *
 * It exists because `undefined` was overloaded (#2841 review §5.A). The gates
 * below took `indexRows?: IndexCatalogRow[]`, so "my read failed" and "I passed
 * you nothing" were the SAME value, and each gate's `?? (await
 * readIndexCatalogRows())` silently re-read the catalog — turning the one shared
 * read the call site documents into three round-trips and three identical
 * warnings on the failure path, with the two gates free to decide from DIFFERENT
 * snapshots. A distinct sentinel makes "read, unreadable" a value the parameter
 * can carry, so a supplied snapshot is never re-read.
 */
export declare const INDEX_CATALOG_UNREADABLE: unique symbol;
/**
 * One `CALL SHOW_INDEXES()` read in a form that survives being handed from one
 * gate to the next: the rows, or {@link INDEX_CATALOG_UNREADABLE} when the read
 * failed.
 */
export type IndexCatalogSnapshot = IndexCatalogRow[] | typeof INDEX_CATALOG_UNREADABLE;
/**
 * {@link readIndexCatalogRows} in snapshot form — what callers should read once
 * and pass to EVERY extension-gated-DML gate in a run, so the "one shared
 * `SHOW_INDEXES` read" invariant holds on the failure branch too (#2841 review
 * §5.A). The `IndexCatalogRow[] | undefined` spelling stays available for
 * callers that only want the rows.
 */
export declare const readIndexCatalogSnapshot: () => Promise<IndexCatalogSnapshot>;
/**
 * Resolve a gate's optional `indexRows` argument into the rows it must judge,
 * reading the catalog AT MOST ONCE and ONLY when the caller supplied nothing.
 *
 * The `??` is meaningful again (#2841 review §5.A): `undefined` in can now only
 * mean "no snapshot supplied", because a caller whose own read failed passes
 * {@link INDEX_CATALOG_UNREADABLE}, which is truthy and short-circuits it.
 * `undefined` OUT keeps its documented meaning — "could not prove anything",
 * which every caller of {@link readIndexCatalogRows} treats as fail-closed.
 *
 * Exported for the `dropSearchFTSIndexes` sweep in `core/search/fts-indexes.ts`,
 * which takes the same optional-snapshot parameter and must resolve it by the
 * same rules — including the "a supplied snapshot is never re-read" half.
 */
export declare const resolveGateRows: (indexRows: IndexCatalogSnapshot | undefined) => Promise<IndexCatalogRow[] | undefined>;
/**
 * Make DML against {@link EMBEDDING_TABLE_NAME} legal on the writable
 * connection when it can be, and report whether it is.
 *
 * LadybugDB refuses EVERY mutation of a table carrying an HNSW index while
 * the VECTOR extension is not loaded on that connection: `DELETE` fails with
 * "Trying to delete from an index on table CodeEmbedding but its extension is
 * not loaded", `CREATE` with the matching "insert into an index" variant,
 * `DROP TABLE` is refused while the index references it, and `SET` — even on
 * a NON-indexed property — segfaults the process outright. Probed against
 * @ladybugdb/core 0.18.2 (the lockfile-pinned version) and 0.18.0 — every
 * result identical on both (#2623).
 *
 * Dropping the index is NOT an available recovery: `CALL DROP_VECTOR_INDEX`
 * is itself a VECTOR-extension function and resolves to "Catalog exception:
 * function DROP_VECTOR_INDEX is not defined" in exactly the state it would
 * need to rescue. Loading the extension is the only in-place repair, which is
 * why this returns a verdict instead of attempting a fixup.
 *
 * `true` = embedding-row DML is safe: either VECTOR is now loaded, or the
 * table carries no index to trip over. `false` = genuinely blocked (index
 * present, extension unloadable); the analyze orchestrator answers that by
 * escalating to the wipe-and-rebuild write plan instead of failing
 * mid-writeback.
 *
 * Cheap by construction: one {@link readIndexCatalogRows} read settles the
 * common "this repo never built an embedding index" case without touching the
 * extension machinery at all, so a VECTOR-less machine is not charged a bounded
 * INSTALL attempt on every incremental analyze. (That read's own mechanics and
 * fail-closed contract are documented there, not re-explained here — #2841
 * review §5.H.)
 *
 * @param indexRows An {@link IndexCatalogSnapshot} the caller already read, so
 * one `SHOW_INDEXES` read can settle every gate in a run. FRESHNESS CONTRACT:
 * the snapshot must have been taken on THIS connection with nothing in between
 * that creates or drops an index — the gate's verdict is only as current as the
 * rows it is handed. Pass {@link INDEX_CATALOG_UNREADABLE} (what
 * {@link readIndexCatalogSnapshot} returns) when your own read failed; that
 * fails closed here WITHOUT a second read. Omit the argument entirely to have
 * the gate read the catalog itself.
 */
export declare const ensureEmbeddingRowDmlSafe: (indexRows?: IndexCatalogSnapshot) => Promise<boolean>;
/**
 * The FTS twin of {@link ensureEmbeddingRowDmlSafe} (#2841).
 *
 * LadybugDB refuses DML against a table carrying an FTS index while the FTS
 * extension is not loaded on that connection, and it refuses it at BIND time —
 * probed against @ladybugdb/core 0.18.3, a DETACH DELETE matching ZERO rows
 * fails just as hard as one matching thousands ("Binder exception: Trying to
 * delete from an index on table File but its extension is not loaded"). Every
 * table in `FTS_INDEXES` is therefore immutable until the extension loads, and
 * there is no narrower escape: `CALL DROP_FTS_INDEX` is itself an
 * FTS-extension function ("Catalog exception: function DROP_FTS_INDEX is not
 * defined" in exactly the state that would need rescuing), and LadybugDB has
 * no SQL `DROP INDEX` at all (both spellings are Parser exceptions). Rebuilding
 * the DB file is the only way to clear the indexes without the extension.
 *
 * `true` = FTS-indexed-table DML is safe: either FTS is now loaded, or the DB
 * carries no FTS index to trip over. `false` = genuinely blocked; the analyze
 * orchestrator answers that by escalating to the wipe-and-rebuild write plan
 * instead of dying mid-writeback with an engine error that never says "FTS".
 *
 * Catalog-first for the same reason as the VECTOR twin: a repo whose index
 * never carried FTS must not pay a bounded INSTALL attempt on every
 * incremental analyze. Keyed on index TYPE, so an index left over from an
 * older `FTS_INDEXES` (different name/table set) still counts.
 *
 * @param indexRows Same contract as {@link ensureEmbeddingRowDmlSafe}'s: an
 * {@link IndexCatalogSnapshot} read on THIS connection with no index created or
 * dropped since, so both gates decide from the SAME snapshot and the catalog is
 * read once per run. {@link INDEX_CATALOG_UNREADABLE} fails closed here without
 * a second read; omitting the argument makes the gate read for itself.
 */
export declare const ensureFtsRowDmlSafe: (indexRows?: IndexCatalogSnapshot) => Promise<boolean>;
/**
 * Lazy-create an FTS index, caching the fact in-process.
 *
 * Kept for writable maintenance paths that need to lazily materialize an
 * index. Read-only query paths must not call this; production analysis owns
 * creating the configured search indexes before the database is served.
 *
 * Safe to call repeatedly — the in-process Set guarantees only the first
 * call hits LadybugDB. `closeLbug` clears the cache so re-init starts fresh.
 *
 * Defense in depth: if the active connection is read-only (e.g. the MCP
 * pool adapter), `CREATE_FTS_INDEX` will fail with "Cannot execute write
 * operations in a read-only database". Treat that as a no-op and cache
 * the key so callers don't loop on a path that can never succeed here —
 * the index is owned by `gitnexus analyze` (writable) and either already
 * exists or will be created on the next analyze.
 */
export declare const ensureFTSIndex: (tableName: string, indexName: string, properties: string[], stemmer?: string) => Promise<void>;
export type FtsQueryFailureClass = 'missing-index' | 'missing-table' | 'other';
/**
 * Classify a `QUERY_FTS_INDEX` failure so a genuinely-missing index (normal —
 * this table's FTS index hasn't been built yet) is distinguished from a real
 * query-time error that would otherwise look identical (#2767), and from the
 * table itself being missing (schema drift / a corrupted or partial DB — a
 * much more serious condition than an unbuilt index).
 *
 * tri-review Residual-1: this used to be a second, independently-maintained
 * classifier living in `core/search/bm25-index.ts` (re-exported from there
 * for backward compatibility), duplicating this function's job for the
 * IDENTICAL `QUERY_FTS_INDEX` cypher call. `queryFTS` below now uses this
 * same classifier for its own catch instead of a bare, unanchored
 * `.includes('does not exist')` check that could not tell "index missing"
 * from "table missing" apart, and silently swallowed both alike.
 *
 * Three real message shapes were confirmed empirically against a live
 * `CALL QUERY_FTS_INDEX(...)`:
 * `"Prepare failed: Binder exception: Table <T> doesn't have an index with
 * name <name>."` — the table exists, only its FTS index is missing (normal,
 * benign — `missing-index`) — `"Prepare failed: Binder exception: Table <T>
 * does not exist."` — the TABLE ITSELF is missing (`missing-table`) — and a
 * `Catalog exception: function QUERY_FTS_INDEX is not defined...` when the
 * FTS extension isn't loaded at all (`other`; mirrors the confirmed
 * `DROP_FTS_INDEX` shape in {@link isBenignDropFtsIndexError}'s doc comment).
 *
 * Anchored to the exception class (after stripping the optional "Prepare
 * failed: " wrapper LadybugDB adds for statement-preparation failures),
 * mirroring `isBenignDropFtsIndexError`'s START-of-message anchor: a bare
 * substring search would misclassify a genuine, differently-classed error
 * (e.g. a `Runtime exception` from the FTS parser that echoes the user's
 * own search text back into its message) as benign whenever that echoed
 * text happened to contain "does not exist" — silently dropping a real
 * error, the exact #2767 failure mode this function exists to prevent.
 */
export declare const classifyFtsQueryError: (message: string) => FtsQueryFailureClass;
export declare const buildFtsQueryCypher: (tableName: string, indexName: string, limit: number, conjunctive?: boolean) => string;
/**
 * Query a full-text search index
 * @param tableName - The node table name
 * @param indexName - FTS index name
 * @param query - Search query string
 * @param limit - Maximum results
 * @param conjunctive - If true, all terms must match (AND); if false, any term matches (OR)
 * @returns Array of { node properties, score }
 */
export declare const queryFTS: (tableName: string, indexName: string, query: string, limit?: number, conjunctive?: boolean) => Promise<Array<{
    nodeId: string;
    name: string;
    filePath: string;
    score: number;
    [key: string]: any;
}>>;
/**
 * True for the two benign "nothing to drop" `DROP_FTS_INDEX` failures —
 * both catalog/binder exceptions, LadybugDB's classes for "this name isn't
 * bound to anything right now" (probe-verified end-to-end through
 * `dropFTSIndex`'s real `conn.query()` path against @ladybugdb/core
 * 0.18.x): the named index was never created (`Binder exception: Table <T>
 * doesn't have an index with name <name>.`), or the FTS extension/function
 * isn't registered at all (`Catalog exception: function DROP_FTS_INDEX is
 * not defined...`). A real engine failure — e.g. the `Runtime exception:
 * FTS index '<name>' is inconsistent: ...` class from #2589 — is a
 * DIFFERENT exception class (an execution-time failure, not a catalog/bind
 * lookup miss), so this returns false for it. Anchored to the START of the
 * message (not a bare substring search): every probed LadybugDB error leads
 * with its exception class, and anchoring means a future message that merely
 * mentions "Binder exception" or "Catalog exception" further in in the body
 * of an otherwise-genuine failure can't be misclassified as benign. Pure
 * string logic so it is unit-testable without a native LadybugDB connection.
 */
export declare const isBenignDropFtsIndexError: (message: string) => boolean;
/**
 * Drop an FTS index. Tolerates only {@link isBenignDropFtsIndexError} —
 * anything else rethrows instead of being silently masked, which previously
 * let a corrupted index persist across analyze runs undetected.
 *
 * One benign class is conditional (#2841): `Catalog exception: function
 * DROP_FTS_INDEX is not defined` says the FTS extension is not loaded, which
 * is "nothing to drop" only when the named index does not exist. When it DOES
 * exist, swallowing that error reports a drop that never happened, and the
 * next insert/delete against that table dies at bind time with an engine
 * message that never mentions FTS — the #2841 crash. So the liveness question
 * is settled with a catalog read on the ERROR path only (the healthy path
 * still costs nothing) and a live-but-undroppable index is raised loudly,
 * naming FTS and both remedies — the load-side one CLASSIFIED, never
 * hand-rolled (#2841 review §5.G).
 *
 * A catalog that cannot be read blocks identically (see
 * {@link ftsIndexPresenceInCatalog}) but is reported as an inability to verify,
 * not as an assertion that the index exists.
 */
export declare const dropFTSIndex: (tableName: string, indexName: string) => Promise<void>;
