import type { RepoMeta } from '../storage/repo-manager.js';
export declare const INDEX_INCOMPLETE_REASONS: readonly ["incremental-in-progress", "embedding-checkpoint-pending", "embedding-count-unverified", "graph-write-collapsed"];
export type IndexIncompleteReason = (typeof INDEX_INCOMPLETE_REASONS)[number];
/**
 * Fraction of the pipeline's relationship count that must survive into the DB
 * before the write counts as collapsed. Deliberately generous: this detects
 * "most of the graph did not persist" (the reported case lost ~91%), not a
 * per-edge reconciliation.
 */
export declare const GRAPH_WRITE_COLLAPSE_RATIO = 0.5;
/**
 * Below this many relationships the ratio is meaningless — a handful of edges
 * lost to legitimate filtering would trip it — so small repos are exempt.
 */
export declare const GRAPH_WRITE_COLLAPSE_MIN_EDGES = 100;
/** Why {@link detectGraphWriteCollapse} could reach no verdict at all. */
export type GraphWriteCollapseUnmeasurableReason = 
/** The pipeline's own total was not a usable number (or was zero). */
'expected-unavailable'
/** The DB-side count could not be READ — a query that threw, no connection. */
 | 'persisted-unreadable'
/** Set by the CALLER: an incremental write persists only the changed
 *  subgraph, so whole-scope counts are not comparable to it. */
 | 'incremental-write';
/**
 * The three outcomes of the collapse check, kept APART because two of them used
 * to share `undefined` and the conflation erased a stamp recording real,
 * unrepaired edge loss.
 *
 * `'healthy'` is a POSITIVE all-clear — the counts were both taken and enough
 * rows persisted — and is the only outcome that licenses clearing a previous
 * `graph-write-collapsed` stamp. `'unmeasurable'` says the comparison never
 * happened; the previous stamp must survive it, because nothing has repaired
 * whatever it recorded.
 */
export type GraphWriteCollapseVerdict = {
    verdict: 'collapsed';
    expected: number;
    persisted: number;
} | {
    verdict: 'healthy';
} | {
    verdict: 'unmeasurable';
    reason: GraphWriteCollapseUnmeasurableReason;
};
/**
 * Decide whether a finished write collapsed, comparing what the pipeline
 * produced against what the DB hands back.
 *
 * A RATIO, not equality: some relationship types do not round-trip one-for-one
 * and `--pdg` writes MORE rows into the same table, so demanding equality would
 * fire on healthy runs. Only a collapse is a defect.
 *
 * FAIL-SAFE at `expected === 0`: an implementation that offloads relationships
 * out of memory may not be able to report a total, and a false "your index is
 * broken" is worse than a missed one. That case is `'unmeasurable'`, NOT
 * `'healthy'` — nothing was compared, so nothing was cleared.
 *
 * Returns a THREE-WAY verdict rather than `{...} | undefined`. The absent value
 * meant both "measured, fine" and "could not measure", and the caller — which
 * decides whether to keep or erase the persisted `graph-write-collapsed` stamp —
 * cannot tell those apart from a shared `undefined`. It guessed by write mode
 * instead, so a full run whose structural count threw took the
 * "no collapse ⇒ clear it" branch and deleted a stamp recording real loss.
 */
export declare function detectGraphWriteCollapse(expected: number, 
/**
 * Relationships readable from the DB, or `undefined` when the count could
 * not be READ at all (no connection, a query that threw).
 *
 * The distinction is load-bearing and was got wrong once: `getLbugStats`
 * reports `edges: 0` for "no connection", "query threw" AND "empty table"
 * alike, so passing it straight in made every run without a readable DB look
 * like a total collapse. An unmeasurable count is not a measured zero —
 * accepting `undefined` here is what keeps this check from committing the
 * same confident-zero error it exists to catch.
 */
persisted: number | undefined): GraphWriteCollapseVerdict;
/** Stable machine-readable reasons an index cannot be certified complete. */
export declare function getIndexIncompleteReasons(meta: Pick<RepoMeta, 'incrementalInProgress' | 'embeddingCheckpoint' | 'graphWriteCollapsed'> | null | undefined): IndexIncompleteReason[];
