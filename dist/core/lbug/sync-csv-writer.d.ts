/**
 * Synchronous buffered CSV writer, shared by the streaming emit sinks.
 *
 * Extracted verbatim from `pdg-emit-sink.ts` (issue #2202) so the structural
 * `GraphEmitSink` (#2680) reuses the same buffering and IO-fault discipline
 * instead of duplicating ~90 lines of it. No behaviour change: `PdgEmitSink`
 * imports this class and is otherwise untouched.
 *
 * Why synchronous? The emit loops these sinks sit under are synchronous — there
 * is no `await` point to drain an async stream, so a `WriteStream` would
 * accumulate unwritten chunks in process memory across millions of rows,
 * defeating the RSS bound this exists to provide. `fs.writeSync` goes straight
 * to the OS; resident memory is bounded to one `chunkRows` buffer. This mirrors
 * the sync-shard pattern in `storage/parsedfile-store.ts`.
 */
/** Default streamed-write buffer (rows), shared by both sinks. */
export declare const DEFAULT_EMIT_CHUNK_ROWS = 500;
export declare class SyncCsvWriter {
    readonly csvPath: string;
    private fd;
    private buf;
    private readonly chunkRows;
    rows: number;
    /**
     * First IO error this writer hit (a `fs.writeSync` short-write loop throwing
     * on e.g. disk-full). Once poisoned the writer refuses further rows and
     * skips its final flush; the owning sink surfaces it from its `finalize()`
     * so a truncated CSV is never handed to the bulk COPY (#2202 review #4). A
     * streamed-write failure is an IO fault, not the logic error that the emit
     * loops' per-file try/catch is built to swallow — poisoning routes it past
     * that catch to a loud failure.
     */
    poison: unknown | undefined;
    constructor(csvPath: string, header: string, chunkRows: number);
    addRow(row: string): void;
    /** Flush, recording (and re-throwing) any IO error as poison. Re-throwing
     *  lets the immediate caller log the per-file failure; the persisted `poison`
     *  is the backstop that makes finalize fail loudly even when that throw is
     *  swallowed by an emit loop's try/catch. */
    private flushOrPoison;
    private flush;
    /** Flush remaining rows (unless already poisoned) and close the fd. Never
     *  throws: a final-flush IO error is recorded as poison and the fd is still
     *  closed, so a write error neither leaks an fd nor escapes here — the owning
     *  sink reads {@link poison} after closing every writer and fails loudly then. */
    close(): void;
}
