import type { GraphNode, GraphRelationship, RelationshipType } from '../../_shared/index.js';
import type { KnowledgeGraph } from '../graph/types.js';
/**
 * Relationship types that MUST stay in the in-memory graph because a phase
 * running while streaming is active reads them back.
 *
 * Derived from an exhaustive audit of every relationship read site under
 * `gitnexus/src/` (`iterRelationshipsByType` / `iterRelationships` /
 * `forEachRelationship` / `removeRelationship`), not from intuition — an
 * earlier draft of this list carried 14 types, 5 of which no reachable phase
 * reads. Every entry below names its reader:
 *
 *   EXTENDS, IMPLEMENTS  - mro-processor, scope-resolution/passes/mro,
 *                          receiver-bound-calls, pipeline/run.ts, cpp
 *                          member-lookup, and 9 language scope-resolvers
 *   HAS_METHOD           - mro-processor, di phase
 *   HAS_PROPERTY         - di phase, ruby scope-resolver, spring config-bindings
 *   METHOD_OVERRIDES,
 *   METHOD_IMPLEMENTS    - mro-processor
 *   DEFINES              - local-symbol-pruner's isFileDefinesEdge test
 *   INJECTS              - di phase fan-out
 *
 * Deliberately NOT retained: STEP_IN_PROCESS / ENTRY_POINT_OF / MEMBER_OF
 * (written only by the `processes` / `communities` phases, which the streaming
 * flag disables), TAINT_PATH / CALL_SUMMARY (their phases are likewise gated
 * off under the flag), and HANDLES_ROUTE / HANDLES_TOOL (written by
 * `routes`/`tools`, never read back mid-pipeline).
 *
 * Adding a relationship type that a phase reads back WITHOUT adding it here is
 * a silent-wrong-graph bug, not a crash. The differential round-trip test cannot:
 * `addRelationship` partitions edges
 * between the graph and the CSVs, and the union of a partition is invariant
 * under where the partition line falls, so that test stays green no matter how
 * this set is drawn. Only the read-site audit protects this invariant; re-run it
 * (grep iterRelationshipsByType / iterRelationships / forEachRelationship /
 * removeRelationship across src/) when adding a phase or a relationship type.
 */
export declare const RETAINED_REL_TYPES: ReadonlySet<RelationshipType>;
/**
 * COPY manifest produced by {@link GraphEmitSink.finalize}.
 *
 * Only `relsByPair` — this PR does not stream node rows, so a `nodeFiles`
 * dimension would be permanently empty. Note that unlike `PdgEmitManifest`,
 * these pair keys DO collide with the whole-graph emit's (streamed `CALLS` is
 * `Function|Function`, same as retained edges), so `loadGraphToLbug` must
 * APPEND these files to the pair rather than reject them as a collision.
 */
export interface GraphEmitManifest {
    /** pairKey (`From|To`) -> per-pair edge CSV. */
    readonly relsByPair: Map<string, {
        csvPath: string;
        rows: number;
    }>;
    /** Total streamed rows, for the buffer-pool size hint (#2631 path). */
    readonly totalRows: number;
    /**
     * Streamed rows EXCLUDING `PDG_EDGE_TYPES`, for the graph-write-collapse
     * check — which counts persisted STRUCTURAL rows and so needs a structural
     * expectation to compare against.
     *
     * Not derivable from `relsByPair`: a pair key is `From|To` NODE LABELS, and
     * a PDG edge shares `Function|Function` with `CALLS`. Only the write path
     * sees `relationship.type`, so the split has to be counted here.
     *
     * This existed as a bug first. `totalRows` is a buffer-pool size hint and
     * counts every row; the collapse check reused it as the expectation while
     * measuring structural rows on the other side. On a `--pdg` run that compared
     * ~200k against ~65k and declared a healthy index INCOMPLETE — then the
     * collapse stamp forced a rebuild on the next run, which did it again.
     */
    readonly structuralRows: number;
}
/**
 * The slice of the sink that pipeline phases drive. Declared here, next to the
 * implementation, and imported as a type by `pipeline-phases/types.ts` so the
 * phase layer depends on this narrow capability rather than on two loose
 * callbacks bolted onto the context.
 */
export interface GraphEmitControl {
    /** Start routing non-retained relationships to disk (see {@link GraphEmitSink.beginStreaming}). */
    beginStreaming(): void;
}
/** Thrown when a consumer removes a relationship that already streamed to
 *  disk. Silently no-oping would let a mutating consumer (e.g. the COBOL
 *  cross-program CALL resolver) corrupt the persisted graph undetected. */
export declare class StreamedRelationshipRemovalError extends Error {
    constructor(relationshipId: string);
}
/**
 * Write-routing graph façade. Construct one per analyze run at the PARSE
 * boundary — not at `createKnowledgeGraph()` — so the pre-parse phases
 * (`structure`, `springConfig`, `markdown`, `cobol`) complete their
 * read-modify-delete passes against a fully in-memory graph. Call
 * {@link finalize} once after the pipeline, before `loadGraphToLbug`.
 */
export declare class GraphEmitSink implements KnowledgeGraph, GraphEmitControl {
    private readonly real;
    private readonly csvDir;
    private readonly chunkRows;
    private readonly relWriters;
    /**
     * Ids of relationships already streamed. `KnowledgeGraph.addRelationship`
     * drops duplicate ids first-writer-wins, and COPY into a PK-bearing table
     * would violate on a repeat, so the sink must dedup itself — unlike
     * `PdgEmitSink`, whose emit loop guarantees per-file uniqueness upstream.
     *
     * ponytail: O(streamed-edges) id strings retained. That is ~a tenth of full
     * edge retention (the objects, both endpoint index Sets, and the type bucket
     * all go away), but it is not O(chunk). Upgrade path if it ever dominates:
     * a per-pair sorted-run dedup on disk, or hashing ids into a Bloom filter
     * with an exact fallback.
     */
    private readonly streamedIds;
    /**
     * Streamed edges, kept as parallel columns so the sink can still answer a
     * COMPLETE relationship read (see {@link iterRelationships}). Only the four
     * fields any consumer of these edges actually reads are retained —
     * `sourceId`, `targetId`, `type`, `confidence` — audited across
     * community-processor, process-processor, taint-summaries and the pruner.
     *
     * `id`, `reason` and `step` are deliberately NOT kept. Every relationship id
     * is a unique long string, and retaining ids is exactly what made an earlier
     * fully-columnar attempt LOSE to the object-based graph (measured 838 MB vs
     * 822 MB at 400k nodes / 1.08M edges). Keeping ids out of the heap is where
     * the saving comes from, so a read synthesizes a deterministic id instead —
     * safe because `buildRelRow` never persists `rel.id` and no consumer keys on
     * it (audited).
     *
     * The dropped `reason`/`step` are safe too, but for a different reason worth
     * stating: the PERSISTED row keeps their true values, because `buildRelRow` is
     * handed the original relationship on the way through. Only in-memory reads
     * see the `'streamed'` placeholder, and the in-pipeline consumers of streamed
     * edges read neither field. So e.g. the `ACCESSES reason: 'read'|'write'`
     * distinction that MCP queries rely on survives in the database. A future
     * in-pipeline consumer needing `reason` or `step` on a streamed edge must add
     * the column, not trust the placeholder.
     *
     * Node ids are interned; the strings are shared by reference with the node
     * map's, so interning adds bookkeeping, not new text.
     */
    private readonly nodeIds;
    private readonly nodeIdByIx;
    private readonly srcIx;
    private readonly tgtIx;
    private readonly relTypes;
    private readonly confidences;
    private finalized;
    /**
     * Streaming is OFF until {@link beginStreaming} is called by `parse`.
     *
     * The pre-parse phases are not all write-only: `mapCobolToGraph` scans
     * `CALLS` edges and REMOVES the unresolved ones after adding resolved
     * replacements (cobol-processor.ts). If the sink streamed from
     * construction, that scan would see an empty set, no COBOL cross-program
     * call would ever resolve, and the removal would be a silent no-op. Nothing
     * before parse produces bulk edge volume, so deferring costs nothing.
     */
    private armed;
    /**
     * First writer-construction failure (`fs.openSync` throwing on e.g. EMFILE).
     * It happens inside the `SyncCsvWriter` constructor before a writer object
     * exists to carry poison, so it is held at sink level and folded into the
     * {@link finalize} error check — otherwise an open failure mid-emit would be
     * swallowed by a caller's try/catch and silently drop the rest of the rows.
     */
    private openFailure;
    constructor(real: KnowledgeGraph, csvDir: string, chunkRows?: number);
    /** Nodes are never streamed (see the file header) — always the real graph. */
    addNode(node: GraphNode): void;
    /**
     * Start streaming. Called once, by the `parse` phase, for the reason on
     * {@link armed}.
     */
    beginStreaming(): void;
    /**
     * Exact dedup key, built to hold no reference to the relationship id.
     *
     * An id embeds both node ids in full — ~200 characters on this repo — and the
     * only information it adds beyond `(type, source, target)` is a short trailing
     * disambiguator, e.g. `emit-references.ts` appends `:line:col` so two calls
     * between the same pair at different sites stay distinct. The endpoints are
     * already interned for the columns, so the key reuses those indices and parses
     * the tail into NUMBERS.
     *
     * Numbers matter for more than size: a key built by slicing or replacing
     * inside a long string is a V8 sliced/cons string that keeps its parent alive,
     * so the 200-character id would never be freed and the memory saving would
     * silently fail to materialize. Parsing to numbers severs that link.
     *
     * Falls back to the full id when the tail is not a numeric `:a:b` form (other
     * id shapes exist, e.g. `rel:contains:` has no tail). Correctness first: an
     * unrecognized shape is stored exactly, just without the saving.
     */
    private dedupKey;
    private internNode;
    /** Rebuild a streamed edge; its id is synthesized lazily, not stored. */
    private streamedAt;
    addRelationship(relationship: GraphRelationship): void;
    /** Flush + close every writer and return the COPY manifest. Every fd is
     *  closed even when a writer is poisoned; any IO fault — an in-flight write,
     *  a final-flush failure, or a writer-open failure (EMFILE) — is surfaced
     *  loudly here so a disk-full / out-of-fds run never hands a truncated CSV to
     *  the bulk COPY. */
    /** Streamed rows that are not PDG — see `GraphEmitManifest.structuralRows`. */
    private structuralRows;
    finalize(): GraphEmitManifest;
    /** Best-effort fd release for the error path — when the pipeline throws
     *  before {@link finalize} runs, the caller's `finally` calls this so the
     *  per-pair fds never leak. Idempotent with finalize via `finalized`. */
    close(): void;
    get nodes(): GraphNode[];
    get relationships(): GraphRelationship[];
    iterNodes(): IterableIterator<GraphNode>;
    /**
     * Retained edges followed by the streamed ones, so every consumer sees a
     * complete graph and no phase needs to know streaming happened. This is what
     * lets streaming be the default.
     *
     * Hand-rolled rather than a generator: a generator pays per-`yield` machinery
     * on every one of millions of edges, and the pruner and process extraction
     * walk this three times per analyze.
     */
    iterRelationships(): IterableIterator<GraphRelationship>;
    iterRelationshipsByType(type: RelationshipType): IterableIterator<GraphRelationship>;
    forEachNode(fn: (node: GraphNode) => void): void;
    /**
     * The fast path: streamed edges are read straight out of the columns, so a
     * whole-graph scan allocates NOTHING. This is what keeps iteration at parity
     * with the object-based graph despite holding relationships columnar.
     */
    forEachRelationshipFields(fn: (sourceId: string, targetId: string, type: RelationshipType, confidence: number) => void): void;
    /** Direct loop rather than delegating to {@link iterRelationships}: this is
     *  the form community detection uses (twice), and skipping the generator and
     *  iterator protocol is measurably cheaper on a million-edge scan. */
    forEachRelationship(fn: (rel: GraphRelationship) => void): void;
    getNode(id: string): GraphNode | undefined;
    get nodeCount(): number;
    /** Retained edges only — streamed edges are gone from the heap by design.
     *  `run-analyze.ts` sizes the LadybugDB buffer pool from this, so it adds
     *  the manifest's `totalRows` back in (the hint only ever shrinks the pool,
     *  so under-reporting would starve the COPY at exactly the scale this
     *  feature targets). */
    get relationshipCount(): number;
    removeNode(nodeId: string): boolean;
    removeNodesByFile(filePath: string): number;
    /**
     * Deliberately conservative. The dedup Set holds compact keys derived from a
     * relationship's endpoints ({@link dedupKey}), and a bare id alone cannot be
     * turned back into one — so a streamed edge is not directly identifiable here.
     *
     * Rather than risk the silent case (returning `false` for an edge that IS on
     * disk and cannot be recalled), anything the real graph does not hold is
     * treated as possibly-streamed once streaming has begun, and fails loudly. A
     * genuinely-absent id therefore throws too, where the object-based graph would
     * return `false`; that is acceptable because the only production caller is the
     * COBOL resolver, which runs BEFORE the sink is armed and so takes the branch
     * below.
     *
     * NOTE this diverges from {@link KnowledgeGraph.removeRelationship}, which
     * returns `false` for an id it does not hold. Pinned by a test so the
     * divergence stays deliberate.
     */
    removeRelationship(relationshipId: string): boolean;
}
