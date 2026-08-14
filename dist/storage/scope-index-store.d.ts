/**
 * Disk-backed scope store + lazy `ScopeTree` (out-of-core scope index — kernel scope-resolution
 * out-of-core index).
 *
 * ## Why this exists
 *
 * The scope-resolution resident floor is dominated by the per-`Scope` binding
 * payload (`Scope.bindings` / `typeBindings` / `ownedDefs`) — ~17-20 GB for one
 * language on the Linux kernel — held in `preExtractedByPath` AND aliased by the
 * finalize `scopeTree` through the whole emit phase. The emit passes never read
 * `parsed.scopes` directly; they reach scopes EXCLUSIVELY through
 * `scopeTree.getScope(id)` (a point lookup) and `getChildren(id)`. So the heavy
 * scope payload can move to disk behind that point lookup without changing what
 * any consumer observes: every consumer reads a `Scope` BY VALUE (its `bindings`
 * / `ownedDefs` contents, `parent`, `range`), never by object identity.
 *
 * {@link persistScopeShards} writes the scopes to per-file JSON shards (one file
 * = one shard, so a file's whole parent-chain — which never crosses filePath —
 * stays within one shard) using the same `mapReplacer` + def-interning reviver
 * the ParsedFile store proved byte-identical (#1983 / def-object interning). {@link DiskBackedScopeTree}
 * serves `getScope` from a bounded LRU of decoded shards plus a small resident
 * skeleton (`scopeId -> {shard, childIds, parent}`), so only the working set of
 * scopes is resident, not all of them.
 *
 * Default-off: only constructed when `GITNEXUS_DISK_SCOPE_INDEX` is set. The
 * resident `buildScopeTree` path is untouched otherwise.
 */
import type { Scope, ScopeId, ScopeTree } from '../_shared/index.js';
/** Resident per-scope skeleton — everything `ScopeTree` answers WITHOUT the heavy
 *  binding payload. `shard` names the on-disk file holding the full `Scope`. */
interface ScopeSkeletonEntry {
    readonly shard: string;
    readonly parent: ScopeId | null;
    readonly childIds: ScopeId[];
}
export declare const getScopeIndexStoreDir: (storagePath: string) => string;
/**
 * Remove any prior seal's scope shards so a fresh seal starts clean. The shard
 * names are sequential (`s<n>.json`) and the index resets per `persistScopeShards`
 * call, so without this a seal that writes FEWER shards than a previous one (a
 * later language with fewer files, or a later run of a shrunken repo) would leave
 * stale tail shards on disk indefinitely — pure garbage the disk-backed tree
 * never reads, but multi-GB on kernel-scale repos. Idempotent; synchronous to
 * fit the main-thread seal path. Safe to call before each seal: the previously
 * sealed language has finished emit and been released before the next seal runs,
 * so its `DiskBackedScopeTree` never reads these shards again.
 */
export declare const clearScopeIndexStore: (storagePath: string) => void;
/**
 * Persist `scopes` to per-file shards under `<storagePath>/scope-index-store/`
 * and return the resident skeleton the {@link DiskBackedScopeTree} needs. Sharded
 * by `filePath` (sequential `s<n>.json` names — no filePath→filename encoding),
 * so one file's full scope subtree round-trips together. Synchronous: pass-A runs
 * on the main thread and this replaces an in-heap `buildScopeTree`.
 */
export declare const persistScopeShards: (storagePath: string, scopes: readonly Scope[]) => ReadonlyMap<ScopeId, ScopeSkeletonEntry>;
/**
 * A `ScopeTree` that serves `getScope` from disk shards via a bounded LRU,
 * holding only `maxResidentShards` decoded shards + the resident skeleton. Drop-in
 * for the in-heap `buildScopeTree` result for the methods scope-resolution
 * actually calls — `getScope` (the hot one), `getChildren`, `getParent`,
 * `getAncestors`, `has`, `size`. `byId` (a full materialization) is only used by
 * the `INGESTION_EMIT_SCOPES=1` debug path and is unsupported here — the two flags
 * are mutually exclusive.
 */
export declare class DiskBackedScopeTree implements ScopeTree {
    private readonly dir;
    private readonly skeleton;
    private readonly maxResidentShards;
    /** Decoded shards, most-recently-used last (Map preserves insertion order). */
    private readonly lru;
    constructor(storagePath: string, skeleton: ReadonlyMap<ScopeId, ScopeSkeletonEntry>, maxResidentShards?: number);
    get size(): number;
    get byId(): ReadonlyMap<ScopeId, Scope>;
    has(id: ScopeId): boolean;
    getChildren(id: ScopeId): readonly ScopeId[];
    getScope(id: ScopeId): Scope | undefined;
    getParent(id: ScopeId): Scope | undefined;
    getAncestors(id: ScopeId): readonly ScopeId[];
    /** Load + decode a shard, touch it as MRU, evict the LRU tail past the cap. */
    private loadShard;
}
/**
 * A `ScopeTree` that starts fully resident (validated by `buildScopeTree`, used
 * by finalize / propagate / resolve, which may mutate `Scope.typeBindings` in
 * place) and then {@link seal}s to a {@link DiskBackedScopeTree} just before emit.
 *
 * Sealing is what actually frees the ~17-20 GB of `Scope.bindings`: the resident
 * tree is held BY THE MODEL'S frozen index bundle, so it cannot be swapped out
 * from the outside. This wrapper IS that held object — `seal()` mutates its own
 * (non-frozen) internal field to null the resident tree from the inside, after
 * persisting it, so the model's reference now points at the disk-backed serving
 * path and the heavy scopes become collectible (once the emit-side ParsedFiles
 * also drop their `scopes`). Idempotent; a no-op before `seal()` keeps today's
 * fully-resident behavior byte-identical.
 */
export declare class TransitionalScopeTree implements ScopeTree {
    private resident;
    private disk;
    constructor(scopes: readonly Scope[]);
    /** Persist the resident scopes, switch to disk-backed serving, and drop the
     *  resident tree so its scope/binding payload can be reclaimed. Idempotent. */
    seal(storagePath: string, maxResidentShards?: number): void;
    get sealed(): boolean;
    private get active();
    get size(): number;
    get byId(): ReadonlyMap<ScopeId, Scope>;
    has(id: ScopeId): boolean;
    getScope(id: ScopeId): Scope | undefined;
    getParent(id: ScopeId): Scope | undefined;
    getChildren(id: ScopeId): readonly ScopeId[];
    getAncestors(id: ScopeId): readonly ScopeId[];
}
export {};
