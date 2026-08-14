/**
 * CSV Generator for LadybugDB Hybrid Schema
 *
 * Streams CSV rows directly to disk files in a single pass over graph nodes.
 * File contents are lazy-read from disk per-node to avoid holding the entire
 * repo in RAM. Rows are buffered (FLUSH_BYTES) before writing to minimize
 * per-row Promise overhead.
 *
 * RFC 4180 Compliant:
 * - Fields containing commas, double quotes, or newlines are enclosed in double quotes
 * - Double quotes within fields are escaped by doubling them ("")
 * - All fields are consistently quoted for safety with code content
 */
import type { GraphNode, GraphRelationship } from '../../_shared/index.js';
import { KnowledgeGraph } from '../graph/types.js';
import { NodeTableName } from './schema.js';
/** Computed once — `RELATION_SCHEMA` is a static template literal. Exported so
 *  the streamed sinks (`GraphEmitSink`, `PdgEmitSink`) share this parse
 *  instead of each re-deriving it from the same DDL string. */
export declare const DECLARED_RELATION_PAIRS: ReadonlySet<string>;
/**
 * Flush buffered rows to disk once the buffered chunk reaches this many bytes.
 * Byte-bounded rather than row-count-bounded: row size ranges from a few dozen
 * bytes (typical symbol/relationship rows) up to a full File's content
 * (#2317/#2323), so a row-count-only cap lets a handful of huge rows build an
 * unbounded `buffer.join('\n')` string before ever tripping it.
 *
 * Not an env knob — fixed by a safety margin, not a preference. The one worst
 * case that matters: one more oversized row lands right after the buffer was
 * just under this threshold, before the flush fires. That row is capped at
 * TREE_SITTER_MAX_BUFFER (32MB, hard-clamped — GITNEXUS_MAX_FILE_SIZE cannot
 * raise it). Two transforms can each grow it before it reaches the buffer:
 * `applyCjkSegmentationIfEnabled` (#2331, `CJK_BIGRAM_WORST_CASE_GROWTH_FACTOR`
 * on an all-CJK row when `GITNEXUS_FTS_CJK_SEGMENTATION=bigram` — the single
 * source of truth for that ratio, imported by the paired test) and
 * `escapeCSVField`'s worst-case quote-doubling (2x). So the peak joined-string
 * size is bounded by
 *   FLUSH_BYTES + 2 * CJK_BIGRAM_WORST_CASE_GROWTH_FACTOR * TREE_SITTER_MAX_BUFFER
 *     ≈ 8MB + 149MB ≈ 157MB,
 * versus Node's `buffer.constants.MAX_STRING_LENGTH` (~512MB) — the test
 * actually enforces half of that (~256MB), for a ~1.63x margin (see the
 * `shouldFlushCSVBuffer stays within the V8 string-length ceiling` test,
 * which fails loudly if any of these constants ever moves this margin the
 * wrong way). With segmentation disabled (default), the old ~3.56x margin
 * still applies. Raising FLUSH_BYTES trades fewer/larger flushes for less
 * margin; lowering it trades the reverse for lower peak transient memory.
 * Change the constant directly if a real workload needs a different point on
 * that curve — a per-host env var would let the margin get silently
 * reintroduced by an operator with no way to know why 512MB is dangerous.
 */
export declare const FLUSH_BYTES: number;
export declare const shouldFlushCSVBuffer: (byteCount: number) => boolean;
export declare const sanitizeUTF8: (str: string) => string;
export declare const escapeCSVField: (value: string | number | undefined | null) => string;
export declare const escapeCSVNumber: (value: number | undefined | null, defaultValue?: number) => string;
/**
 * Did this text come from a binary payload? Density of non-printables over the
 * first {@link BINARY_SAMPLE_CHARS} characters, above 10%.
 *
 * U+FFFD counts, and it is the character that matters most here (#2889). Every
 * source file enters the pipeline through a `utf-8` decode — the content cache
 * below reads with `fs.readFile(path, 'utf-8')`, and the parse worker decodes
 * the same way. That decode is lossy and total: an invalid byte sequence never
 * survives as invalid bytes, it is REPLACED with U+FFFD. So the embedded-binary
 * payloads #2889 describes (webpack bundles, class-file constant pools,
 * serialized objects inside .js/.vue sources) arrive here as long runs of
 * U+FFFD, not as the control bytes this scan was originally written to count —
 * charCode 0xFFFD is neither `< 9`, nor between 13 and 32, nor 127, so the
 * detector scored a wholly corrupt payload as clean text and every caller waved
 * it through.
 *
 * The threshold stays at 10%: a legitimate source file carries no replacement
 * characters at all unless it was mis-decoded, and a handful (a stray latin-1
 * comment, one bad byte in a license header) still scores far under the bar.
 * Density rather than "contains any binary run" is deliberate — a description
 * that is mostly real prose with one stray replacement character is worth more
 * indexed than dropped.
 */
export declare const isBinaryContent: (content: string) => boolean;
/**
 * Flatten newlines and tabs to single spaces for FTS-indexed text columns
 * (`content`, `description`) — the real fix for #2317.
 *
 * Ladybug's full-text-search tokenizer splits ONLY on the space character —
 * `\n`, `\r`, and `\t` are NOT token delimiters. So multiline text indexes as
 * a handful of giant tokens (each whole line, joined across lines), and a
 * word query matches none of them: `searchFTSFromLbug('foo')` misses a file
 * whose content is `... \nfoo\n ...`. Removing the 10KB cap (#2333/#2317)
 * stores the full body but leaves it unsearchable; collapsing intra-text
 * whitespace to spaces is what actually makes every word searchable.
 *
 * This rewrites the STORED column too (the same value is COPYed in), so File
 * content returned via the graph API is space-flattened — an accepted trade
 * for making file/symbol text searchable. Leading/trailing/empty are no-ops.
 *
 * Callers apply `applyCjkSegmentationIfEnabled` (#2331) to the text *before*
 * this flatten, so a CJK phrase split across a line-wrap loses its boundary
 * bigram (run detection resets at whitespace) — an accepted limitation, see
 * the plan's Scope Boundaries.
 *
 * Exported (#2339) so `bm25-index.ts`'s query path can compose it in the
 * same order on incoming search queries, keeping index-time and query-time
 * text transforms symmetric — a literal tab/newline in a query would
 * otherwise fail to match whitespace-normalized indexed content.
 */
export declare const normalizeFtsText: (text: string) => string;
/** Canonical relationship CSV header — shared by the emit pass and the
 * `splitRelCsvByLabelPair` differential oracle. */
export declare const REL_CSV_HEADER = "from,to,type,confidence,reason,step";
/** Build the escaped CSV row (no trailing newline) for one relationship.
 * Single source of the relationship row bytes — used by the emit pass and by
 * the byte-identity differential test that feeds the legacy split oracle. */
export declare const buildRelRow: (rel: GraphRelationship) => string;
/** Canonical BasicBlock node CSV header — taint/PDG substrate (issue #2080).
 * No `name` column; blocks are identified by id + source span. Shared by the
 * whole-graph emit pass and the streaming PDG emit sink (issue #2202) so the
 * two paths produce byte-identical BasicBlock rows by construction. */
export declare const BASICBLOCK_CSV_HEADER = "id,filePath,startLine,endLine,text,callees,calleeIds";
/** Build the escaped CSV row (no trailing newline) for one BasicBlock node.
 * Single source of the BasicBlock row bytes — used by `streamAllCSVsToDisk`
 * and by the streaming `PdgEmitSink` (issue #2202). `callees` is a comma-free
 * (space-joined) list of the leaf callee names invoked in the block — the
 * statement-precise inter-procedural reach substrate (the field is itself a CSV
 * cell, so the inner separator must NOT be a comma). `calleeIds` is the SOUND
 * parallel to `callees`: the space-joined RESOLVED callee symbol ids for the
 * block (#2227 follow-up), likewise a comma-free cell. */
export declare const buildBasicBlockRow: (node: GraphNode) => string;
export interface StreamedCSVResult {
    nodeFiles: Map<NodeTableName, {
        csvPath: string;
        rows: number;
    }>;
    /** pairKey (`From|To`) → per-FROM→TO-label-pair CSV file. */
    relsByPair: Map<string, {
        csvPath: string;
        rows: number;
    }>;
    /** Header line shared by every per-pair file. */
    relHeader: string;
    /** Edges skipped because an endpoint label is not a valid node table. */
    skippedRels: number;
    /** Edges routed to a per-pair file. */
    totalValidRels: number;
}
/**
 * Stream all CSV data directly to disk files.
 * Iterates graph nodes exactly ONCE — routes each node to the right writer.
 * File contents are lazy-read from disk with a generous LRU cache.
 *
 * `onNodePhaseComplete` (optional, #2203 parallelism leg): fired exactly once,
 * right after every node CSV is fully flushed to disk and BEFORE the
 * relationship pass starts writing any `rel_*.csv`. It receives the finished
 * node-file manifest so the caller can begin `COPY`-ing nodes while this
 * function keeps generating relationship CSVs (the only single-writer-safe
 * overlap — node `COPY` ‖ relationship emit). It is intentionally NOT awaited:
 * the relationship pass proceeds concurrently with whatever the caller
 * schedules. A synchronous throw from the callback is allowed and propagates out
 * of this function (rejecting the returned promise) — it is raised before the
 * relationship pass begins, so no `rel_*.csv` is written; `loadGraphToLbug` uses
 * this to surface its PDG-manifest collision guard. The callback must NOT, however,
 * schedule un-awaited async work that can reject unobserved. Absent ⇒ today's
 * behavior, byte-for-byte.
 */
export declare const streamAllCSVsToDisk: (graph: KnowledgeGraph, repoPath: string, csvDir: string, onNodePhaseComplete?: (nodeFiles: Map<NodeTableName, {
    csvPath: string;
    rows: number;
}>) => void) => Promise<StreamedCSVResult>;
