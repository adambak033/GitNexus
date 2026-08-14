import { Worker } from 'node:worker_threads';
export interface WorkerPool {
    /**
     * Dispatch items across workers. Items are split into bounded jobs, each job
     * is committed independently, and stalled jobs are split/retried locally.
     *
     * Files in {@link WorkerPool.getQuarantinedPaths} are filtered out before
     * dispatch — they have already caused a worker death this pool lifetime and
     * are not safe to re-attempt in workers. They are dropped from the run (the
     * sequential fallback that once re-parsed them was removed); inspect the
     * quarantine snapshot before and after each dispatch to surface skipped files
     * in diagnostics.
     */
    dispatch<TInput, TResult>(items: TInput[], onProgress?: (filesProcessed: number) => void, chunkHash?: string): Promise<TResult[]>;
    /** Terminate all workers. Must be called when done. */
    terminate(): Promise<void>;
    /** Number of worker slots originally requested for the pool. */
    readonly size: number;
    /**
     * Snapshot of paths quarantined by this pool instance. Populated when a
     * worker dies with an authoritative in-flight file (Layer 4 starting-file
     * message) or a singleton-timeout exclusion. Cleared only by pool teardown
     * — quarantine is session-scoped per `createWorkerPool` invocation.
     *
     * Optional so external `WorkerPool` shapes (test doubles, alternate
     * implementations) can omit the method without compile errors. Callers
     * (`processParsing`) use optional chaining at the call site to handle
     * absence gracefully.
     */
    getQuarantinedPaths?(): readonly string[];
    /**
     * Throughput / health snapshot for operator observability. Surfaced at
     * chunk boundaries by `parse-impl` when verbose ingestion is enabled
     * so the operator can see whether workers are saturated, idle, or
     * dropping. Optional for compatibility with external `WorkerPool`
     * shapes that predate this method.
     */
    getStats?(): WorkerPoolStats;
}
/** Snapshot returned by {@link WorkerPool.getStats}. */
export interface WorkerPoolStats {
    /** Worker slots configured at pool creation time. */
    readonly size: number;
    /** Slots that are still in the active rotation (have not been dropped
     *  for exceeding their respawn budget and have not been cleared by
     *  the circuit breaker). */
    readonly activeSlots: number;
    /** Slots permanently removed from rotation this pool lifetime
     *  (size - activeSlots). When the circuit breaker has tripped this
     *  equals `size` because activeSlots is cleared. */
    readonly droppedSlots: number;
    /** Cumulative paths quarantined by failure attribution. */
    readonly quarantined: number;
    /** Whether the circuit breaker has tripped (no further dispatches
     *  will be accepted by this pool instance). */
    readonly poolBroken: boolean;
    /** Whether `terminate()` has been called on this pool. Distinguishes
     *  graceful shutdown (terminated=true, activeSlots=0) from a circuit-
     *  breaker trip (terminated=false, poolBroken=true, activeSlots=0).
     *  Optional for backward compatibility with external `WorkerPoolStats`
     *  implementations that predate this field. */
    readonly terminated?: boolean;
    /** Per-slot generation counter (U12). Increments by 1 on every
     *  successful worker replacement for that slot. Operators / tests
     *  observe this to confirm a death-then-respawn actually happened
     *  vs. the same worker being recycled in place. Initial value is 0
     *  for every slot at pool creation; dropped slots keep their last
     *  generation (they don't decrement). Optional so external
     *  `WorkerPoolStats` implementations that predate U12 can omit the
     *  field without a TypeScript compile error — in-repo callers use
     *  optional chaining (`stats?.slotGenerations`) consistently. */
    readonly slotGenerations?: readonly number[];
}
export interface WorkerPoolOptions {
    subBatchSize?: number;
    subBatchMaxBytes?: number;
    subBatchIdleTimeoutMs?: number;
    maxTimeoutRetries?: number;
    timeoutBackoffFactor?: number;
    /**
     * Max replacement spawns per worker slot before the slot is dropped from
     * the active rotation. Bounds respawn loops on a slot that consistently
     * crashes the worker (likely a system-level fault rather than a single
     * bad input). Default 3.
     */
    maxRespawnsPerSlot?: number;
    /**
     * Hard ceiling on total wall time the pool will spend retrying / splitting
     * any single job. Combined with `timeoutBackoffFactor`, this prevents
     * exponentially-growing retry waits from accumulating into multi-hour
     * stalls before the pool finally quarantines the bad file and proceeds
     * without it. Default 5x `subBatchIdleTimeoutMs`.
     */
    maxCumulativeTimeoutMs?: number;
    /**
     * Number of consecutive worker deaths (no successful job in between) that
     * trip the pool circuit breaker. Once tripped, the pool rejects every
     * subsequent `dispatch` with `WorkerPoolDispatchError` until a new pool is
     * created. Default `Math.max(3, poolSize)`.
     */
    consecutiveFailureThreshold?: number;
    /**
     * Startup budget in milliseconds for a replacement worker to emit the
     * `{type:'ready'}` handshake before the pool treats it as a startup
     * crash (see {@link waitForWorkerReady}). Default 5000; also overridable
     * via `GITNEXUS_WORKER_READY_TIMEOUT_MS`, mirroring
     * `GITNEXUS_WORKER_SUB_BATCH_TIMEOUT_MS`. On a slow or heavily loaded
     * host, a full pool of workers cold-starting concurrently can
     * legitimately need more than 5s to load the native grammar bindings —
     * without the override every slot times out and the pool misclassifies
     * the slow start as a deterministic startup crash-loop, aborting the
     * whole analyze.
     */
    workerReadyTimeoutMs?: number;
    /**
     * Test-only injection point for the Worker constructor. When provided,
     * the pool uses this factory instead of `new Worker(workerUrl)`. Production
     * code should leave this unset.
     */
    workerFactory?: (workerUrl: URL) => Worker;
    /**
     * Test-only injection point for the main-thread stall probe (#2649):
     * returns cumulative event-loop stall in ms. When provided, the pool
     * skips its heartbeat tracker and reads this instead. Production code
     * should leave this unset.
     */
    stallMsProbe?: () => number;
    /**
     * Storage path for the disk-backed ParsedFile store (#1983 parallel
     * serialization). When set, it is baked into every spawned worker's
     * `workerData` so the worker writes its own ParsedFile shards to disk
     * instead of returning them over the MessageChannel for the main thread to
     * serialize. Immutable for the run; captured in the default factory closure
     * so RESPAWNED workers inherit it automatically (all spawn sites reuse the
     * same factory). `undefined` ⇒ workers fall back to returning ParsedFiles in
     * the result (small-repo / no-storage path).
     */
    parsedFileStoreStoragePath?: string;
    /**
     * Directory for the DURABLE, content-addressed ParsedFile store
     * (`getDurableParsedFileDir`). When set (alongside a chunk hash on the
     * dispatch), the worker ALSO writes its ParsedFiles to a content-addressed
     * shard keyed by chunk hash so a future warm parse-cache hit can restore
     * them without re-parsing (#2038 warm-cache coverage). Baked into every
     * worker's `workerData` exactly like {@link parsedFileStoreStoragePath}.
     * `undefined` ⇒ no durable write.
     */
    durableParsedFileStoragePath?: string;
    /**
     * CFG/PDG opt-in (#2081 M1). Baked into every spawned worker's `workerData`
     * (like the store paths above); when `true`, workers build a per-function
     * control-flow graph from the tree-sitter AST and attach it to
     * `ParsedFile.cfgSideChannel`. `undefined`/`false` ⇒ no CFG work.
     */
    pdg?: boolean;
    /** Per-function source-line cap for worker-side CFG construction (0 ⇒ no cap). */
    pdgMaxFunctionLines?: number;
    /**
     * Max wall time `terminate()` waits for a retired worker that has NOT yet
     * reached a JS-visible safe point before giving up on terminating it
     * (#2432). Terminating a worker thread that is inside an N-API call aborts
     * the whole process (`Napi::Error` → `std::terminate` → SIGABRT) — and the
     * same abort fires at plain process exit, so the drain is what makes
     * shutdown safe. On expiry the worker is left running (unref'd, with its
     * at-safe-point terminate listener still armed) and a diagnostic is logged.
     * Default 30000ms — above the C++ capture budget
     * (`GITNEXUS_CPP_CAPTURE_BUDGET_MS`, 20000ms) so the drain converges for
     * the known pathological class. 0 ⇒ no wait (test hook).
     */
    shutdownDrainMs?: number;
}
export declare class WorkerPoolDispatchError extends Error {
    /**
     * Snapshot of the pool's session-scoped quarantine at the moment the
     * dispatch error was raised. Surfaced for operator diagnostics: when
     * the circuit breaker trips, this lists the files the pool had
     * already decided were unsafe before the trip. Read-only at the
     * caller boundary; no in-pool consumer rewires it post-construction.
     *
     * Previously named `fallbackExcludePaths` because the (since-
     * removed) sequential-parser fallback in `processParsing` consumed
     * it to filter the fallback file list. After U20's design pivot
     * (worker pool's resilience layers are the sole failure contract;
     * no sequential rescue), the field is informational only. The
     * rename clarifies semantics without changing wire behavior.
     */
    readonly quarantinedPaths: readonly string[];
    constructor(message: string, quarantinedPaths?: readonly string[]);
}
/**
 * How a total worker-startup failure was classified by the pool's bounded
 * self-heal (#1741). Lets the caller render an accurate cause without
 * inspecting any operator flag:
 *  - 'deterministic-startup': ≥2 fresh workers crashed with the SAME signature
 *    before any reached ready (e.g. a missing native binding) — retrying is
 *    futile, so the pool short-circuited fast.
 *  - 'transient-exhausted': workers crashed variably and exhausted the bounded
 *    startup retry budget without ever reaching ready.
 */
export type StartupCrashClass = 'deterministic-startup' | 'transient-exhausted';
export declare class WorkerPoolInitializationError extends WorkerPoolDispatchError {
    readonly readinessFailures: readonly string[];
    /** Pool's automatic classification of the startup crash (#1741). */
    readonly crashClass: StartupCrashClass;
    constructor(message: string, quarantinedPaths?: readonly string[], readinessFailures?: readonly string[], crashClass?: StartupCrashClass);
}
/**
 * Thrown when a caller asks GitNexus to parse without the worker pool —
 * `--workers 0`, `GITNEXUS_WORKER_POOL_SIZE=0`, or `skipWorkers: true`.
 *
 * GitNexus no longer has a sequential parser: the worker pool (with its
 * quarantine + respawn/recycle + circuit-breaker resilience) is the SOLE
 * parse path. These channels used to select an in-process fallback; they are
 * now hard configuration errors so the operator gets an actionable message
 * instead of silently parsing through a (deleted) slower path.
 */
export declare class WorkerPoolDisabledError extends Error {
    constructor(message: string);
}
interface ResolvedWorkerPoolOptions {
    subBatchSize: number;
    subBatchMaxBytes: number;
    subBatchIdleTimeoutMs: number;
    maxTimeoutRetries: number;
    timeoutBackoffFactor: number;
    maxRespawnsPerSlot: number;
    maxCumulativeTimeoutMs: number;
    consecutiveFailureThreshold: number;
    shutdownDrainMs: number;
    workerReadyTimeoutMs: number;
}
export declare function resolveWorkerPoolOptions(options?: WorkerPoolOptions, poolSize?: number): ResolvedWorkerPoolOptions;
/**
 * True when the operator set `GITNEXUS_WORKER_POOL_SIZE=0` — the env-channel
 * equivalent of `--workers 0`. The parse phase consults this (only when no
 * explicit `--workers <N>` was passed) and HARD-ERRORS: sequential parsing was
 * removed, so a disabled pool is an actionable configuration error, not a
 * silent fallback. An explicit positive `--workers N` always wins.
 */
export declare function workerPoolDisabledByEnv(): boolean;
/**
 * Resolve the auto-default worker pool size when no explicit `poolSize`
 * arg is passed to `createWorkerPool`. Precedence:
 *
 * 1. `GITNEXUS_WORKER_POOL_SIZE` env var (operator override).
 * 2. `os.cpus().length - 1`, clamped to `[1, DEFAULT_POOL_SIZE_CAP]`.
 *
 * The cap exists because past ~16 workers the main-thread merge /
 * extraction work and structured-clone overhead dominate; adding more
 * worker threads costs memory without much throughput gain. Operators
 * who want to push past the cap set the env var explicitly.
 *
 * Exported for unit tests; production code should not call this
 * directly — pass an explicit `poolSize` to `createWorkerPool` or rely
 * on the env / default.
 */
export declare function resolveAutoPoolSize(): number;
export declare function startHeartbeatStallTracker(): {
    read: () => number;
    stop: () => void;
};
/**
 * Per-worker V8 old-generation heap cap in MB (#2649). Without one, worker
 * isolates inherit an unbounded default and a full pool can inflate process
 * RSS past physical RAM on large repos. Half of RAM split across the pool,
 * clamped to [512, 4096] MB — generous for the per-sub-batch working set
 * (jobs are byte-budgeted), and a worker that does exceed it dies with a
 * real heap error surfaced by the stderr-tail machinery + the
 * quarantine/respawn path, instead of silently dragging the host into swap.
 * `GITNEXUS_WORKER_HEAP_MB` overrides the formula. Exported for unit tests.
 */
export declare function resolveWorkerHeapCapMb(poolSize: number): number;
export declare const createWorkerPool: (workerUrl: URL, poolSize?: number, options?: WorkerPoolOptions) => WorkerPool;
export {};
