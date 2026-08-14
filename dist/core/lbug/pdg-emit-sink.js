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
import fs from 'fs';
import path from 'path';
import { BASICBLOCK_CSV_HEADER, DECLARED_RELATION_PAIRS, REL_CSV_HEADER, buildBasicBlockRow, buildRelRow, } from './csv-generator.js';
import { VALID_NODE_TABLES, assertDeclaredPair, relPairKeyFor, splitRelPairKey, } from './rel-pair-routing.js';
import { DEFAULT_EMIT_CHUNK_ROWS, SyncCsvWriter } from './sync-csv-writer.js';
/**
 * PDG edge types streamed per-file (all intra-block BasicBlock→BasicBlock).
 * `TAINT_PATH` is intentionally excluded — it is the whole-program M4 edge
 * (Function→Function), computed in a separate post-resolution phase over the
 * complete CALLS graph, and stays in the in-memory graph (it is small and is
 * persisted by the normal whole-graph emit).
 */
export const PDG_EDGE_TYPES = new Set([
    'CFG',
    'REACHING_DEF',
    'CDG',
    'POST_DOMINATE',
    'TAINTED',
    'SANITIZES',
]);
/** Default streamed-write buffer (rows). Matches the whole-graph emit's
 *  `FLUSH_EVERY` order of magnitude; overridable via `GITNEXUS_PDG_EMIT_CHUNK_SIZE`.
 *  Aliases the shared default in `sync-csv-writer.ts` (#2680 extraction). */
export const DEFAULT_PDG_EMIT_CHUNK_ROWS = DEFAULT_EMIT_CHUNK_ROWS;
/**
 * Write-routing graph façade. Construct one per analyze run, thread it into the
 * per-language `runScopeResolution` calls in place of the real graph during the
 * `--pdg` emit, then {@link finalize} once after the last language.
 */
export class PdgEmitSink {
    real;
    pdgCsvDir;
    chunkRows;
    bbWriter;
    /** pairKey (`From|To`) → writer. PDG edges are all `BasicBlock|BasicBlock`,
     *  but the map keeps the sink general and the manifest pair-keyed. */
    relWriters = new Map();
    finalized = false;
    /**
     * First writer-construction failure (a `fs.openSync` throwing on e.g. EMFILE
     * — out of file descriptors). The failure happens inside the `SyncCsvWriter`
     * constructor before a writer object exists to carry poison, so it is held
     * here at the sink level and folded into the {@link finalize} error check.
     * Like an in-flight write fault, an open failure mid-emit would otherwise be
     * swallowed by the emit loop's per-file try/catch and silently drop the rest
     * of that file's rows (#2202 review #4/#6).
     */
    openFailure = undefined;
    // NOTE on dedup: the same file can be PDG-emitted in more than one language
    // pass (e.g. a `.ts` module imported by a `.vue` SFC is emitted in both the
    // TypeScript pass and the Vue context pass over the same worker-built
    // `cfgSideChannel`). The in-memory graph dedups that by id (first-writer-wins);
    // this sink does NOT — to keep peak memory O(write buffer) rather than
    // O(total ids), cross-pass dedup is done upstream, per FILE, in the emit loop
    // (`run.ts` skips a file whose PDG already streamed via `pdgEmittedFiles`).
    // The sink therefore receives each id exactly once and is a faithful
    // pass-through; it must not be fed duplicate ids.
    constructor(real, pdgCsvDir, chunkRows = DEFAULT_PDG_EMIT_CHUNK_ROWS) {
        this.real = real;
        this.pdgCsvDir = pdgCsvDir;
        this.chunkRows = chunkRows;
        // Clear any streamed CSVs left by a previous (possibly crashed) run so a
        // later COPY never picks up stale rows.
        fs.rmSync(pdgCsvDir, { recursive: true, force: true });
        fs.mkdirSync(pdgCsvDir, { recursive: true });
    }
    // ── routed writes ──────────────────────────────────────────────────────────
    addNode(node) {
        if (node.label === 'BasicBlock') {
            if (this.bbWriter === undefined) {
                try {
                    this.bbWriter = new SyncCsvWriter(path.join(this.pdgCsvDir, 'basicblock.csv'), BASICBLOCK_CSV_HEADER, this.chunkRows);
                }
                catch (e) {
                    this.openFailure ??= e;
                    throw e;
                }
            }
            this.bbWriter.addRow(buildBasicBlockRow(node));
            return;
        }
        this.real.addNode(node);
    }
    addRelationship(relationship) {
        if (PDG_EDGE_TYPES.has(relationship.type)) {
            // Classify + skip via the SHARED `relPairKeyFor`, not a local copy of its
            // three lines, so the streamed set cannot drift from the whole-graph set
            // `RelPairRouter` produces. `undefined` = an endpoint label is not a node
            // table, so the edge is dropped exactly as the router drops it.
            const pairKey = relPairKeyFor(relationship.sourceId, relationship.targetId, VALID_NODE_TABLES);
            if (pairKey === undefined)
                return;
            assertDeclaredPair(pairKey, DECLARED_RELATION_PAIRS, relationship.type, relationship.sourceId, relationship.targetId);
            let writer = this.relWriters.get(pairKey);
            if (writer === undefined) {
                // Cold: once per pair, so decoding the key back into labels is free.
                const [fromLabel, toLabel] = splitRelPairKey(pairKey);
                try {
                    writer = new SyncCsvWriter(path.join(this.pdgCsvDir, `rel_${fromLabel}_${toLabel}.csv`), REL_CSV_HEADER, this.chunkRows);
                }
                catch (e) {
                    this.openFailure ??= e;
                    throw e;
                }
                this.relWriters.set(pairKey, writer);
            }
            writer.addRow(buildRelRow(relationship));
            return;
        }
        this.real.addRelationship(relationship);
    }
    /** Flush + close every streamed writer and return the COPY manifest. Every
     *  fd is closed even when a writer is poisoned (its `close` never throws); any
     *  IO fault — an in-flight write that poisoned a writer, a final-flush failure,
     *  or a writer-open failure (EMFILE) — is surfaced loudly here so a disk-full
     *  / out-of-fds run never hands a truncated CSV to the bulk COPY (#2202 review
     *  #4). The emit loop's per-file try/catch swallows the synchronous throw, so
     *  this poison check is the backstop that turns a silent partial manifest into
     *  a hard failure. */
    finalize() {
        if (this.finalized)
            throw new Error('PdgEmitSink.finalize() called twice');
        this.finalized = true;
        const errors = [];
        if (this.openFailure !== undefined)
            errors.push(this.openFailure);
        const nodeFiles = new Map();
        if (this.bbWriter !== undefined) {
            this.bbWriter.close();
            if (this.bbWriter.poison !== undefined)
                errors.push(this.bbWriter.poison);
            nodeFiles.set('BasicBlock', {
                csvPath: this.bbWriter.csvPath,
                rows: this.bbWriter.rows,
            });
        }
        const relsByPair = new Map();
        for (const [pairKey, writer] of this.relWriters) {
            writer.close();
            if (writer.poison !== undefined)
                errors.push(writer.poison);
            relsByPair.set(pairKey, { csvPath: writer.csvPath, rows: writer.rows });
        }
        if (errors.length > 0) {
            const first = errors[0];
            throw new Error(`PdgEmitSink: ${errors.length} streamed CSV writer(s) hit an IO error ` +
                `(disk-full / out-of-fds) during the emit — the persisted graph would ` +
                `be truncated, so the run is failed rather than COPYing a partial CSV: ${first instanceof Error ? first.message : String(first)}`);
        }
        return { nodeFiles, relsByPair };
    }
    /**
     * Best-effort fd release for the error path — when a language pass throws
     * before {@link finalize} runs, the caller's `finally` calls this so the
     * BasicBlock + per-pair fds never leak. Idempotent with finalize via the
     * `finalized` flag; close errors are swallowed because the run is already
     * failing.
     */
    close() {
        if (this.finalized)
            return;
        this.finalized = true;
        try {
            this.bbWriter?.close();
        }
        catch {
            /* best-effort */
        }
        for (const writer of this.relWriters.values()) {
            try {
                writer.close();
            }
            catch {
                /* best-effort */
            }
        }
    }
    // ── delegated reads / non-PDG mutations ─────────────────────────────────────
    // The PDG emit functions never call these on the routed graph, but the
    // façade implements the full KnowledgeGraph surface so it is a drop-in for
    // the emit target and any non-PDG write transparently reaches the real graph.
    get nodes() {
        return this.real.nodes;
    }
    get relationships() {
        return this.real.relationships;
    }
    iterNodes() {
        return this.real.iterNodes();
    }
    iterRelationships() {
        return this.real.iterRelationships();
    }
    iterRelationshipsByType(type) {
        return this.real.iterRelationshipsByType(type);
    }
    forEachNode(fn) {
        this.real.forEachNode(fn);
    }
    forEachRelationship(fn) {
        this.real.forEachRelationship(fn);
    }
    forEachRelationshipFields(fn) {
        this.real.forEachRelationshipFields(fn);
    }
    getNode(id) {
        return this.real.getNode(id);
    }
    get nodeCount() {
        return this.real.nodeCount;
    }
    get relationshipCount() {
        return this.real.relationshipCount;
    }
    removeNode(nodeId) {
        return this.real.removeNode(nodeId);
    }
    removeNodesByFile(filePath) {
        return this.real.removeNodesByFile(filePath);
    }
    removeRelationship(relationshipId) {
        return this.real.removeRelationship(relationshipId);
    }
}
