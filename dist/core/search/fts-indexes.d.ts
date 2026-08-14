import { type IndexCatalogSnapshot } from '../lbug/lbug-adapter.js';
/**
 * Strip filesystem paths from a LadybugDB error before it reaches the HTTP
 * `/api/search` and MCP query surfaces (#2374, PR #2375): the raw LOAD error
 * embeds the absolute extension path (username, home dir) which must not leak to
 * a network client. The error class words ("Failed to load library", "invalid
 * ELF header", "has not been installed") have no leading path separator and
 * survive. CLI/doctor/log surfaces keep the full path (they read the reason
 * directly, not through this function).
 *
 * tri-review Residual-3: every real message shape observed from LadybugDB
 * wraps the path in single quotes (`Failed to load library '<path>': ...`),
 * so a QUOTED path is redacted first, consuming through its closing quote —
 * spaces included (e.g. a Windows username like `alice smith`). The original
 * unquoted-stop-at-first-whitespace pattern still runs afterward as a
 * fallback for the rare case of a path appearing without quotes; that path's
 * own known limitation (partial redaction if it itself contains a space) is
 * unchanged, but is no longer the ONLY path this function knows how to redact.
 */
export declare const redactPaths: (reason: string) => string;
/**
 * Resolved-repo/index identity a caller can attach to a degraded-FTS warning
 * (#2767) so a reader can tell whether *this* session even resolved the index
 * they expect, instead of guessing between a stale connection, a different
 * repo/branch, or a genuine build failure. MCP-`query`-only today — never
 * forwarded into the HTTP `/api/search` response (see that call site).
 */
export interface FtsWarningContext {
    repoName: string;
    branch?: string;
    indexedAt?: string;
    /** Already redacted by the caller (e.g. via {@link redactPaths} on a captured query error). */
    lastErrorRedacted?: string;
}
/**
 * Warning attached to search responses when BM25/FTS is degraded. Prefers the
 * live extension-load failure (with LadybugDB's real reason, #2374) over the
 * generic indexes-missing message, so "indexes exist but the extension broke"
 * is not misreported as missing indexes.
 *
 * `context`, when supplied, appends the resolved repo/branch/indexed-at (and
 * redacted query-error detail, if captured) so a CLI/MCP mismatch — or a real
 * query error masquerading as "indexes missing" — is visible in the warning
 * text itself (#2767). Optional and additive: omitting it reproduces today's
 * exact message.
 */
export declare const ftsDegradedWarning: (context?: FtsWarningContext) => string;
/**
 * Warning for when the FTS extension is loaded and indexes exist, but every
 * configured table's query failed for a real, non-benign reason (timeout,
 * connection reset, native fault) — as opposed to `ftsDegradedWarning`'s
 * missing-index case. `--repair-fts` will not fix a query/connection error,
 * so this deliberately does NOT suggest it: reusing the missing-index
 * message here would reproduce, for this cause, the exact misleading
 * "run --repair-fts" guidance #2767 itself was about (tri-review NEW-1).
 */
export declare const ftsQueryFailedWarning: (context: FtsWarningContext) => string;
export declare const SUPPORTED_FTS_STEMMERS: ReadonlySet<string>;
export interface CreateSearchFTSIndexesOptions {
    onIndexStart?: (table: string, indexName: string) => void;
    onIndexReady?: (table: string, indexName: string) => void;
}
/**
 * Resolve + validate `GITNEXUS_FTS_STEMMER` once, up front at analyze startup,
 * and cache it. An invalid value throws here — in milliseconds — instead of
 * ~85% into a run (after the expensive parse/scope-resolution work). The cached
 * value is what {@link getSearchFTSStemmer} returns for the rest of the run, so
 * config is read and validated in exactly one place.
 */
export declare function initialiseSearchFTSStemmer(): string;
/**
 * Return the stemmer resolved by {@link initialiseSearchFTSStemmer}. Falls back
 * to resolving on demand when init was never called (read-only hosts, unit
 * tests) so validation always applies.
 */
export declare function getSearchFTSStemmer(): string;
/**
 * Drop every configured FTS index ahead of any DML that mutates an FTS-indexed
 * table's rows: LadybugDB's FTS extension is not proven to survive a DETACH
 * DELETE against a table that still carries a live index from a prior run
 * (#2589) — dropping first removes that hazard entirely, regardless of whether
 * it also fixed a specific native inconsistency.
 *
 * CALLER OBLIGATION (#2841). `dropFTSIndex` still no-ops per index when the
 * index is ABSENT, but "unloadable" is no longer unconditionally tolerated: a
 * LIVE index plus an FTS extension that cannot load now THROWS, naming FTS and
 * its remedies, instead of reporting a drop that never happened and letting the
 * next insert/delete die at bind time with a message that never mentions FTS.
 * Nothing in the type system enforces that — callers must have already proven
 * the extension is loadable (`ensureFtsRowDmlSafe()` returning `true`, or a
 * direct `loadFTSExtension()`) before calling this. `run-analyze.ts` settles it
 * at the incremental extension gate and escalates to a full wipe-and-rebuild
 * write plan when the gate says no, so this function is only reached on the
 * branch where the drops can actually succeed.
 *
 * @param indexRows An {@link IndexCatalogSnapshot} the caller already read on
 * THIS connection with no index created or dropped since — the same freshness
 * contract, and the same one-shared-`SHOW_INDEXES`-read purpose, as the gates in
 * `lbug-adapter.ts`. Omit it to have the sweep read the catalog itself.
 */
export declare function dropSearchFTSIndexes(indexRows?: IndexCatalogSnapshot): Promise<void>;
/** One configured index that could not be (re)built, and why. */
export interface FtsIndexBuildFailure {
    table: string;
    indexName: string;
    /** The raw LadybugDB message, unmodified — it is the only row-level evidence there is. */
    error: string;
}
/**
 * Build every configured FTS index, and keep going when one of them fails
 * (#2889).
 *
 * The loop used to let the first failure propagate, which made a single
 * untokenizable row far more expensive than it looks: `dropFTSIndex` has
 * already run for the failing table, so that table ends with NO index, and
 * every table after it in {@link FTS_INDEXES} order is never reached — on a
 * fresh build, or on the incremental path where `dropSearchFTSIndexes` cleared
 * them all up front, those tables end with no index either. One bad `Method`
 * row therefore cost keyword search on Namespace, Property, Record, Union,
 * Static and Variable as well, and `verifySearchFTSIndexes` never ran to say
 * so. The blast radius was an artifact of loop control flow, not of the data.
 *
 * Isolating per index bounds the damage to the table that actually holds the
 * bad row, and makes `--repair-fts` able to recover everything else. Failures
 * are returned rather than thrown so the caller can decide — degrade or abort —
 * with every failure in hand instead of only the first.
 */
export declare function createSearchFTSIndexes(options?: CreateSearchFTSIndexesOptions): Promise<FtsIndexBuildFailure[]>;
/**
 * One sentence naming every table that failed and why, e.g. `FTS index build
 * failed for 2 of 21 tables: Method.method_fts (Runtime exception: …), …`.
 *
 * Lives here rather than at the call sites because only this module knows the
 * denominator. Both the analyze degrade path and `--repair-fts` render it, so
 * one failure reads the same way whichever command produced it.
 *
 * Embeds the raw LadybugDB message UNREDACTED — CLI and log surfaces only.
 * Anything heading for a network response has to pass it through
 * {@link redactPaths} first, the same rule the query-side warnings follow.
 */
export declare const summarizeFtsIndexBuildFailures: (failures: readonly FtsIndexBuildFailure[]) => string;
export declare function verifySearchFTSIndexes(executeQuery: (cypher: string) => Promise<unknown[]>): Promise<string[]>;
/**
 * Why an FTS build failed, so the caller can react correctly (#2658):
 *
 *  - `capability`: the environment can't support FTS this run, or a single
 *    pre-existing row can't be tokenized (#2544/#2546 "Invalid UTF-8"). The
 *    graph/embeddings work is sound — degrade keyword search and keep exit 0.
 *  - `integrity`: an IO / rename / checkpoint / corruption failure while
 *    writing the index. With the single-writer lock (#2658) this is no longer
 *    "some other analyze racing us" — it's a genuinely broken build on this
 *    disk, so the run must fail loudly rather than publish a clean-looking
 *    index whose search silently never worked.
 */
export type FtsBuildFailureClass = 'capability' | 'integrity';
/**
 * Classify an FTS build failure message. Defaults to `capability` (degrade) —
 * only clearly-integrity failures escalate, so the long-standing resilience to
 * row-level tokenizer errors is preserved and we never newly fail a run on an
 * unrecognised message.
 */
export declare const classifyFtsBuildError: (message: string) => FtsBuildFailureClass;
/**
 * Whether an FTS build failure should ABORT the analyze (throw before publish)
 * rather than degrade to a search-less-but-queryable index (#2658).
 *
 * Only an `integrity` failure on the atomic-swap path is fatal: there the graph
 * was built into a throwaway staging DB, so throwing abandons the staging file
 * and leaves the previous live index intact. On an in-place build
 * (`useAtomicSwap === false`: incremental, Windows default) the graph DML
 * already mutated the LIVE database, so there is nothing to roll back by
 * throwing — degrading to a queryable index with FTS marked unavailable is
 * strictly better than exiting mid-finalization over a dirty, partially-indexed
 * live DB. `capability` failures always degrade.
 */
export declare const ftsFailureIsFatal: (failureClass: FtsBuildFailureClass | undefined, useAtomicSwap: boolean) => boolean;
export interface BuildSearchIndexesResult {
    ok: boolean;
    error?: string;
    /** Present only when `ok` is false. See {@link FtsBuildFailureClass}. */
    failureClass?: FtsBuildFailureClass;
}
/**
 * Build + verify FTS indexes, catching any failure instead of letting it
 * propagate. `createSearchFTSIndexes` re-tokenizes every stored row on every
 * analyze run (see the `ponytail:` comment above) — a native LadybugDB
 * tokenizer error on a single pre-existing row (e.g. a "Failed calling
 * LOWER: Invalid UTF-8", #2544/#2546) must not discard an otherwise-
 * successful analyze's graph/embeddings work. The caller degrades keyword
 * search for this run instead, mirroring the existing FTS-extension-
 * unavailable degrade path in `run-analyze.ts`.
 */
export declare function buildSearchIndexesOrDegrade(executeQuery: (cypher: string) => Promise<unknown[]>, options?: CreateSearchFTSIndexesOptions): Promise<BuildSearchIndexesResult>;
