/**
 * Streaming PDG graph-emit sink (issue #2202).
 *
 * The PDG emit loop (`scope-resolution/pipeline/run.ts`, the `--pdg` block)
 * materializes BasicBlock nodes + intra-file PDG edges (CFG / REACHING_DEF /
 * CDG / POST_DOMINATE / TAINTED / SANITIZES) into the in-memory
 * `KnowledgeGraph`. At full-kernel scale that layer dominates peak RSS
 * (~7 GB at 511K BasicBlocks; ~100 GB extrapolated to the full kernel → OOM).
 *
 * `PdgEmitSink` is a write-routing façade over the real graph: the emit
 * functions are write-only and compute every edge endpoint by deterministic id
 * (audited — no read-back), so the sink can route BasicBlock node rows and PDG
 * edge rows straight to bounded CSV-on-disk writers and **never store them**.
 * The graph's resident size stops growing with the PDG layer → peak RSS becomes
 * O(chunk buffer), not O(graph). Everything else (structural nodes/edges, the
 * whole-program M4 TAINT_PATH edges) is delegated to the real graph unchanged.
 *
 * Why synchronous writers? The whole PDG emit (`runScopeResolution` and its
 * per-file loop) is synchronous — there is no `await` point to drain an async
 * stream, so a `BufferedCSVWriter` (Node `WriteStream`) would accumulate
 * unwritten chunks in process memory across millions of rows, defeating the RSS
 * bound. `fs.writeSync` goes straight to the OS; resident memory is bounded to
 * one `chunkRows` buffer. This mirrors the sync-shard pattern in
 * `storage/parsedfile-store.ts`.
 *
 * Byte-identity (issue acceptance): the sink reuses the SAME shared row
 * builders (`buildBasicBlockRow`, `buildRelRow`) and pair classification
 * (`relPairKeyFor`) as `streamAllCSVsToDisk`, so the streamed CSV line SET is
 * identical to the whole-graph emit's, and the bulk COPY loads the same rows →
 * the persisted graph is SET-identical and DB-identical. The guarantee is
 * set-level, not byte-level on the CSV file: the sink streams rows in emit
 * order and does NOT re-sort them under `GITNEXUS_SORT_GRAPH_OUTPUT`, so a
 * streamed CSV file is not necessarily byte-for-byte equal to the sorted
 * whole-graph CSV — but the row set, and therefore the DB outcome, is. (The
 * streamed CSVs are deleted right after the COPY, so their on-disk byte order
 * is never observed.) Cross-pass dedup is done upstream, per FILE, in the emit
 * loop (`run.ts` skips a file whose PDG already streamed) rather than in the
 * sink, because a file can be PDG-emitted in more than one language pass (a
 * `.ts` module imported by a `.vue` SFC is emitted in both the TypeScript and
 * Vue context passes over the same worker-built CFG) and a sink-level per-id
 * dedup set would retain every id → O(total ids) memory, defeating the
 * O(chunk) RSS bound (#2202 review #1). The differential fingerprint test
 * (issue #2202 U6) and the Vue+TS cross-pass integration test guard the set.
 */
import type { GraphNode, GraphRelationship, RelationshipType } from '../../_shared/index.js';
import type { KnowledgeGraph } from '../graph/types.js';
import { type NodeTableName } from './schema.js';
/**
 * PDG edge types streamed per-file (all intra-block BasicBlock→BasicBlock).
 * `TAINT_PATH` is intentionally excluded — it is the whole-program M4 edge
 * (Function→Function), computed in a separate post-resolution phase over the
 * complete CALLS graph, and stays in the in-memory graph (it is small and is
 * persisted by the normal whole-graph emit).
 */
export declare const PDG_EDGE_TYPES: ReadonlySet<RelationshipType>;
/** Default streamed-write buffer (rows). Matches the whole-graph emit's
 *  `FLUSH_EVERY` order of magnitude; overridable via `GITNEXUS_PDG_EMIT_CHUNK_SIZE`.
 *  Aliases the shared default in `sync-csv-writer.ts` (#2680 extraction). */
export declare const DEFAULT_PDG_EMIT_CHUNK_ROWS = 500;
/**
 * COPY manifest produced by {@link PdgEmitSink.finalize}. Shaped to merge
 * directly into `StreamedCSVResult` so `loadGraphToLbug` COPYs the streamed
 * PDG CSVs through the same per-table / per-pair loops as the structural CSVs.
 * Paths are absolute, so persistence needs no dir recomputation.
 */
export interface PdgEmitManifest {
    /** Node-table CSVs (only `BasicBlock` today). */
    readonly nodeFiles: Map<NodeTableName, {
        csvPath: string;
        rows: number;
    }>;
    /** pairKey (`From|To`) → per-pair edge CSV. */
    readonly relsByPair: Map<string, {
        csvPath: string;
        rows: number;
    }>;
}
/**
 * Write-routing graph façade. Construct one per analyze run, thread it into the
 * per-language `runScopeResolution` calls in place of the real graph during the
 * `--pdg` emit, then {@link finalize} once after the last language.
 */
export declare class PdgEmitSink implements KnowledgeGraph {
    private readonly real;
    private readonly pdgCsvDir;
    private readonly chunkRows;
    private bbWriter;
    /** pairKey (`From|To`) → writer. PDG edges are all `BasicBlock|BasicBlock`,
     *  but the map keeps the sink general and the manifest pair-keyed. */
    private readonly relWriters;
    private finalized;
    /**
     * First writer-construction failure (a `fs.openSync` throwing on e.g. EMFILE
     * — out of file descriptors). The failure happens inside the `SyncCsvWriter`
     * constructor before a writer object exists to carry poison, so it is held
     * here at the sink level and folded into the {@link finalize} error check.
     * Like an in-flight write fault, an open failure mid-emit would otherwise be
     * swallowed by the emit loop's per-file try/catch and silently drop the rest
     * of that file's rows (#2202 review #4/#6).
     */
    private openFailure;
    constructor(real: KnowledgeGraph, pdgCsvDir: string, chunkRows?: number);
    addNode(node: GraphNode): void;
    addRelationship(relationship: GraphRelationship): void;
    /** Flush + close every streamed writer and return the COPY manifest. Every
     *  fd is closed even when a writer is poisoned (its `close` never throws); any
     *  IO fault — an in-flight write that poisoned a writer, a final-flush failure,
     *  or a writer-open failure (EMFILE) — is surfaced loudly here so a disk-full
     *  / out-of-fds run never hands a truncated CSV to the bulk COPY (#2202 review
     *  #4). The emit loop's per-file try/catch swallows the synchronous throw, so
     *  this poison check is the backstop that turns a silent partial manifest into
     *  a hard failure. */
    finalize(): PdgEmitManifest;
    /**
     * Best-effort fd release for the error path — when a language pass throws
     * before {@link finalize} runs, the caller's `finally` calls this so the
     * BasicBlock + per-pair fds never leak. Idempotent with finalize via the
     * `finalized` flag; close errors are swallowed because the run is already
     * failing.
     */
    close(): void;
    get nodes(): GraphNode[];
    get relationships(): GraphRelationship[];
    iterNodes(): IterableIterator<GraphNode>;
    iterRelationships(): IterableIterator<GraphRelationship>;
    iterRelationshipsByType(type: RelationshipType): IterableIterator<GraphRelationship>;
    forEachNode(fn: (node: GraphNode) => void): void;
    forEachRelationship(fn: (rel: GraphRelationship) => void): void;
    forEachRelationshipFields(fn: (sourceId: string, targetId: string, type: RelationshipType, confidence: number) => void): void;
    getNode(id: string): GraphNode | undefined;
    get nodeCount(): number;
    get relationshipCount(): number;
    removeNode(nodeId: string): boolean;
    removeNodesByFile(filePath: string): number;
    removeRelationship(relationshipId: string): boolean;
}
