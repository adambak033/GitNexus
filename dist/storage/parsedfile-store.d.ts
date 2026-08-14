/**
 * Disk-backed `ParsedFile` store (#1983 scope-resolution OOM).
 *
 * ## Why this exists
 *
 * The scope-resolution phase needs a `ParsedFile` (scopes / defs / reference
 * sites) for every file. Historically it re-extracted each file from source on
 * the **main thread** via `extractParsedFile` → `parseSourceSafe`. On a huge
 * repo (Linux kernel, ~64k C files) that re-parse accumulates an unbounded
 * **native** memory leak in `tree-sitter` 0.21.1 (`CallbackInput` retains the
 * input string with no destructor; node-tree-sitter PR #201) — the leaked
 * `TSTree` memory is invisible to V8, never reclaimed by GC, and not freed by
 * worker_thread teardown. The parse phase escapes it only because each parse is
 * relatively cheap there; a second full re-parse of every file on the immortal
 * main thread pushes RSS past the heap cap and the OOM-killer fires.
 *
 * The fix: the parse workers already build a tree-sitter `Tree` per file, so
 * they emit the `ParsedFile` directly (reusing that tree — no second parse).
 * Holding all of them in main-thread heap is what the original #1983 work
 * removed (it cost ~1× the semantic model in RAM during parse), so instead we
 * flush them to this disk store per chunk and stream them back per language in
 * scope-resolution. Net effect: the file is parsed exactly once (in a worker),
 * scope-resolution does ZERO parsing, and peak heap stays bounded.
 *
 * ## Shape
 *
 * `<storagePath>/parsedfile-store/<shardId>.json` — one shard per parse chunk,
 * a JSON array of `ParsedFile` serialized with the same `mapReplacer` the parse
 * cache uses (Scope.bindings / Scope.typeBindings are `Map`s). The store is
 * cleared at the start of each parse and after scope-resolution consumes it, so
 * it never lingers and never goes stale across runs.
 *
 * ## Durable sibling store (`parsedfile-cache/`, warm-cache coverage)
 *
 * The run-scoped store above is only populated when the parse workers actually
 * run. On a warm re-analyze where every chunk is a parse-cache HIT, no worker
 * runs, the run-scoped store was cleared at parse start, and the cached
 * `ParseWorkerResult` carries no `ParsedFile`s (the worker emptied them after
 * its store write) — so scope-resolution would find an empty store and fall
 * back to main-thread `extractParsedFile`, re-opening the #1983 OOM. To close
 * that gap we ALSO write the worker's ParsedFiles to a second, CONTENT-ADDRESSED
 * store keyed by the parse chunk hash (`getDurableParsedFileDir`), which mirrors
 * the parse cache's lifecycle (persists across runs, pruned by `usedKeys`,
 * version-tied via `PARSE_CACHE_VERSION`). On a warm hit the chunk's durable
 * shards are byte-COPIED into the run-scoped store (no re-parse, no
 * re-serialize → byte-identical), so scope-resolution streams them exactly as
 * on a cold run. Content-addressing makes stale reuse impossible: a changed
 * file changes its chunk hash, which misses BOTH stores and re-dispatches.
 */
import type { ParsedFile, SymbolDefinition } from '../_shared/index.js';
/**
 * Build a JSON.parse reviver that (a) interns every string against a shared
 * pool and (b) applies the parse-cache `mapReviver` (Map/Set reconstruction).
 *
 * `JSON.parse` allocates a DISTINCT string object for every textual token, so a
 * `ParsedFile` graph round-tripped through disk holds millions of duplicate
 * strings — every def repeats its `filePath`, and common type/qualified names
 * (`int`, `void`, `struct …`) recur across the whole repo. On the Linux kernel
 * that roughly DOUBLES the deserialized heap (~15 GB vs ~7.6 GB interned).
 * Interning IN the reviver collapses duplicates as the tree is revived (one
 * pass, no second walk). The pool is per-load; the interned strings stay shared
 * through the retained `ParsedFile` references after the pool is dropped.
 */
export declare const makeInterningReviver: (pool: Map<string, string>, defPool: Map<string, SymbolDefinition>) => (key: string, value: unknown) => unknown;
/**
 * Best-effort synchronous GC. Uses `globalThis.gc` when `--expose-gc` is set,
 * else lazily wires it via `v8.setFlagsFromString('--expose-gc')` + a fresh
 * `vm` context. Exported so scope-resolution can reclaim a finished language's
 * ParsedFiles at the per-language eviction boundary (#1741 / kernel memory work).
 */
export declare const forceGc: () => void;
export declare const getParsedFileStoreDir: (storagePath: string) => string;
/** Remove any prior run's shards so a fresh parse starts clean. Idempotent. */
export declare const clearParsedFileStore: (storagePath: string) => Promise<void>;
/**
 * Write one parse chunk's `ParsedFile[]` to the store as a single shard (async).
 * No-op for an empty chunk. `shardId` must be unique within a run. Used by the
 * main-thread no-store-disabled fallback and any non-worker writer; the worker
 * store path uses {@link persistParsedFileShardSync}.
 */
export declare const persistParsedFileChunk: (storagePath: string, shardId: string, parsedFiles: readonly ParsedFile[]) => Promise<void>;
/**
 * Synchronous shard writer for use INSIDE a parse worker (#1983 parallel
 * serialization). The worker is a dedicated thread, so a blocking write there
 * protects the main thread, and a sync write avoids threading `async`/`await`
 * through the synchronous per-file extract loop. Produces byte-identical shards
 * to {@link persistParsedFileChunk} via the shared {@link serializeParsedFileShard}.
 * No-op for an empty chunk. `shardId` must be globally unique for the run (the
 * worker uses `w<threadId>-<seq>`); a duplicate would silently overwrite.
 */
export declare const persistParsedFileShardSync: (storagePath: string, shardId: string, parsedFiles: readonly ParsedFile[]) => void;
/**
 * Stream the store and return the `ParsedFile`s whose `filePath` is in
 * `wantPaths`, keyed by path. Loads one shard at a time and retains only the
 * matching entries, so peak heap is bounded by (matched set) + (one shard)
 * rather than the whole store. Returns an empty map when the store is absent
 * (e.g. tests, or a run with no worker pool) — callers fall back to a fresh
 * extract for the missing files.
 */
export declare const loadParsedFilesForPaths: (storagePath: string, wantPaths: ReadonlySet<string>) => Promise<Map<string, ParsedFile>>;
/** Durable store dir — a sibling of `parsedfile-store/`, NEVER cleared per run. */
export declare const getDurableParsedFileDir: (storagePath: string) => string;
/**
 * Start a fresh durable generation for one content-addressed parse chunk.
 * The main thread calls this once before dispatching a cache miss, before any
 * worker can write that chunk. Recreating the directory immediately keeps the
 * worker-side mkdir memoization valid while preventing old worker shard names
 * from accumulating across analyses.
 */
export declare const prepareDurableParsedFileChunk: (durableDir: string, chunkHash: string) => Promise<void>;
/**
 * Synchronous durable-shard writer for use INSIDE a parse worker, alongside
 * {@link persistParsedFileShardSync}. Writes the SAME bytes to a content-addressed
 * durable location keyed by the parse chunk hash so a future warm hit can reuse
 * them. `chunkHash`+`threadId`+`shardSeq` is collision-free across the
 * N-shards-per-chunk fan-out and across worker-death retries — the same
 * uniqueness that makes the run-scoped `w<tid>-<seq>` name safe, prefixed by
 * content. No-op for an empty chunk.
 */
export declare const persistDurableParsedFileShardSync: (durableDir: string, chunkHash: string, threadId: number, shardSeq: number, parsedFiles: readonly ParsedFile[]) => void;
/**
 * Restore a cached chunk's durable shards into the run-scoped store on a warm
 * hit. A verbatim byte copy (no parse, no re-serialize), so the restored
 * ParsedFiles are byte-identical to a cold run and `loadParsedFilesForPaths`
 * (which keys on `filePath`, not shard name) gives scope-resolution full
 * coverage. The durable shard names already carry the chunk hash, so they never
 * collide with the worker's run-scoped `w<tid>-<seq>` shards. Returns the number
 * of shards restored (0 ⇒ no durable coverage for this chunk; caller treats it
 * as a miss).
 */
export declare const restoreDurableParsedFileShard: (durableDir: string, runStoragePath: string, chunkHash: string) => Promise<number>;
/**
 * Read the durable index and return the set of chunk hashes it vouches for,
 * gated on `expectedVersion` (`PARSE_CACHE_VERSION`). A version mismatch or a
 * missing/corrupt index returns the empty set — the caller then treats every
 * chunk as a durable miss and re-dispatches workers (NEVER the main-thread
 * `extractParsedFile` fallback), which rewrites the durable store under the new
 * version. Mirrors `loadParseCache`'s version-invalidation contract.
 */
export declare const loadDurableParsedFileIndex: (durableDir: string, expectedVersion: string) => Promise<Set<string>>;
/**
 * Prune the durable store to `keepKeys` and rewrite its index. `keepKeys` must
 * be the parse cache's surviving on-disk keys (so the two stores stay coherent:
 * a chunk is "cached" iff BOTH its parse-cache shard and its durable shards
 * exist; a quarantined chunk — no parse-cache shard — drops its durable subdir
 * here and re-dispatches next run). Only subdirs with ≥1 shard are indexed
 * (mirrors `saveParseCache`'s written-keys discipline — never vouch for a chunk
 * hash with no backing shard). The index write is tmp+rename atomic.
 */
export declare const pruneAndSaveDurableParsedFileStore: (durableDir: string, version: string, keepKeys: ReadonlySet<string>) => Promise<void>;
