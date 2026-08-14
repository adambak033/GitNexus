/**
 * Chunk-level content-addressed parse cache.
 *
 * The pipeline always parses every file (correctness invariant: cross-file
 * resolution and downstream phases need full graph data). What this cache
 * does is skip the tree-sitter worker dispatch when a chunk's contents
 * haven't changed since the last run.
 *
 * Granularity: chunk-level. The parse phase chunks files into ~20MB byte
 * budgets. The cache key is `sha256(joined(filePath:contentHash for each
 * file in the chunk, sorted))`. A change to a single file invalidates only
 * that file's chunk — typically 1 of ~50 chunks on a 1000-file repo.
 *
 * Why not per-file:
 * - Workers process sub-batches and emit aggregated `ParseWorkerResult`s.
 *   Splitting back to per-file would require reworking the worker contract.
 * - Chunk-level invalidation gives a useful speedup floor (98% on a single
 *   1-of-50 invalidated chunk) without touching the worker.
 *
 * Survives `--force` because it's content-addressed: the same bytes always
 * produce the same key. `--force` only matters for the LadybugDB writeback;
 * the cache itself is always safe to reuse.
 */
import type { ParseWorkerResult } from '../core/ingestion/workers/parse-worker.js';
export declare const PARSE_CACHE_VERSION: string;
/** Runtime view: keyed Map for fast lookup; mutated in place during a run. */
export interface ParseCache {
    version: string;
    entries: Map<string, ParseWorkerResult[]>;
    /**
     * Hashes referenced (hit OR miss-and-stored) by the current run.
     * The parse phase populates this as it processes chunks; the orchestrator
     * uses it as input to `pruneCache` before saving so entries that no
     * longer correspond to any chunk in the current scan are discarded.
     * Transient — never serialized to disk.
     */
    usedKeys: Set<string>;
    /**
     * When set, chunk payloads are loaded from / flushed to sharded files on
     * demand instead of retaining every chunk in `entries` for the whole run
     * (#1983 — Linux kernel OOM from duplicate in-memory cache + graph).
     */
    storagePath?: string;
    /** Index of chunk hashes known to exist under `storagePath/parse-cache/`. */
    onDiskKeys?: Set<string>;
}
/** Stable hash of a single file's contents — used by callers to compose a chunk hash. */
export declare const fileContentHash: (content: Buffer | string) => string;
/**
 * Compute the canonical cache key for a chunk's contents.
 *
 * `entries` is the list of (filePath, file content hash) for every file
 * in the chunk. We sort by filePath before hashing so chunks composed of
 * the same files in different order produce the same key.
 */
/** PDG/CFG cache namespace (#2081 M1) — every input that changes the
 *  WORKER-EMITTED `cfgSideChannel` must be folded into the chunk key, and
 *  ONLY those. The classification test for a future option: does the worker
 *  see it (workerData) and does it change the bytes the worker writes to the
 *  shard? `pdgMaxEdgesPerFunction` famously fails that test — it is applied
 *  at EMIT time on the main thread (scope-resolution run.ts), the worker
 *  never receives it, and the cached output is byte-identical across cap
 *  values; folding it in (as a prior review round did) only forced a
 *  spurious full re-parse on every cap change (#2099 F3). Options that
 *  change the PERSISTED GRAPH but not the shard belong in the RepoMeta pdg
 *  stamp (incremental-eligibility), not here. */
export interface PdgCacheKey {
    readonly pdg?: boolean;
    /** Per-function source-line cap (changes WHICH functions get a CFG —
     *  applied in the worker, so it shapes the cached shard). Callers must
     *  pass the RESOLVED value (the production call site in parse-impl.ts
     *  applies the worker's default before folding) so an explicit-default
     *  run shares the default run's keys — this function folds whatever it
     *  is given verbatim. */
    readonly maxFunctionLines?: number;
}
export declare const computeChunkHash: (entries: Array<{
    filePath: string;
    contentHash: string;
}>, pdg?: boolean | PdgCacheKey) => string;
export declare const mapReplacer: (_key: string, value: unknown) => unknown;
export declare const mapReviver: (_key: string, value: unknown) => unknown;
/**
 * Drop fields that are not replayed by `mergeChunkResults` / parse-impl after
 * RING4-1 (#942). Shrinks on-disk shards and peak RSS during cold runs.
 */
export declare const slimParseWorkerResultsForCache: (chunkResults: readonly ParseWorkerResult[]) => ParseWorkerResult[];
/** Load one chunk shard. Does not retain it in `cache.entries`. */
export declare const loadParseCacheChunk: (cache: ParseCache, chunkHash: string) => Promise<ParseWorkerResult[] | undefined>;
/**
 * Persist one chunk shard and avoid retaining it in RAM for the rest of the
 * run. Falls back to `cache.entries` when `storagePath` is unset (unit tests).
 */
export declare const persistParseCacheChunk: (cache: ParseCache, chunkHash: string, chunkResults: readonly ParseWorkerResult[]) => Promise<void>;
/**
 * Load the parse cache. Returns an empty cache on any failure (missing
 * file, corrupt JSON, version mismatch). Never throws on a normal load.
 */
export declare const loadParseCache: (storagePath: string) => Promise<ParseCache>;
/**
 * Persist the cache to disk using a temp directory + rename.
 *
 * Writes shards under `${cacheDir}.tmp`, then removes the old `cacheDir` and
 * renames the temp directory into place. There is a crash window after
 * `rm(cacheDir)` and before `rename(tmpDir, cacheDir)` where no cache exists;
 * that is acceptable — `loadParseCache` yields empty and the next run
 * reparses. This is not a single atomic swap of the whole tree, but avoids
 * leaving a half-written shard set visible to readers.
 */
export declare const saveParseCache: (storagePath: string, cache: ParseCache) => Promise<string[]>;
/**
 * Drop entries whose hashes are not in `usedHashes`. Called at the end
 * of a run so chunks that no longer correspond to any current chunk
 * don't keep their stale entries forever.
 */
export declare const pruneCache: (cache: ParseCache, usedHashes: ReadonlySet<string>) => number;
