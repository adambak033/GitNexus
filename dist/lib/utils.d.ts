export declare const generateId: (label: string, name: string) => string;
/**
 * Total order on strings by UTF-16 code unit — deliberately NOT `localeCompare`.
 *
 * `localeCompare` resolves against the host's default ICU locale, so two machines
 * can order the same pair differently and a tie-broken cap keeps a different
 * subset on each (#2787). Code-unit order is host-independent and matches the
 * binary `ORDER BY` the graph queries use, so a JS re-sort reproduces the DB's
 * order instead of fighting it.
 *
 * Use this for every tiebreak that feeds a `.slice()`, a page boundary, or any
 * other cut — `Array.prototype.sort` is stable, so a comparator that returns 0
 * for distinct elements silently falls back to input order.
 */
export declare const compareCodeUnits: (a: string, b: string) => number;
/**
 * How many links of an `Error.cause` chain any walker below visits, counting
 * the head. THE bound — hand-rolled copies had drifted to three different
 * numbers with three different loop conditions (`depth < 5` in two places,
 * `depth <= 5` in a third, i.e. six levels).
 *
 * The bound exists purely so a cyclic chain (`a.cause = b; b.cause = a`)
 * cannot loop forever. Real chains are one or two links deep — the ingestion
 * phase runner wraps a phase failure once as
 * `new Error("Phase 'X' failed: …", { cause })` — so five leaves ample
 * headroom for future nesting.
 */
export declare const CAUSE_CHAIN_MAX_DEPTH = 5;
/**
 * Walk `err` and its `cause` chain, head first, yielding each `Error` link.
 *
 * Stops at the first non-`Error` link (a `cause` may legally be any value, and
 * a non-Error carries no further `cause` worth following) and after
 * `maxDepth` links. Non-`Error` input yields nothing.
 *
 * THE single cause-chain traversal. Consume this (or {@link findInCauseChain})
 * rather than re-rolling the `for (let depth = 0; …; current = current.cause)`
 * loop: every hand-rolled copy has to re-decide the bound and the loop
 * condition, and they did not agree.
 */
export declare function causeChain(err: unknown, maxDepth?: number): Generator<Error>;
/**
 * Find the first link of `err`'s cause chain that `match` accepts.
 *
 * Load-bearing for CLI error classification: the ingestion phase runner
 * rewraps every phase failure as `new Error("Phase 'X' failed: …", { cause })`,
 * so a bare `instanceof` at the CLI boundary misses the real error entirely
 * and falls through to a generic stack dump. Classify by TYPE through this
 * helper (the repo norm from #2385), never by message text.
 */
export declare function findInCauseChain<T>(err: unknown, match: (e: unknown) => e is T, maxDepth?: number): T | undefined;
/**
 * Drop a Windows extended-length (`\\?\`) prefix from a path (#2667).
 *
 * **Comparison domain only.** Never apply this to a string that is about to be
 * handed to `fs`: libuv's `fs__capture_path` only converts WTF-8 to UTF-16 and
 * does *not* re-add the prefix for over-MAX_PATH paths, so stripping an
 * filesystem-facing path would break long-path access on hosts that have not
 * opted into `LongPathsEnabled`. Registry keys, repo-resolution lookups and
 * other pure string comparisons are safe — and are exactly where an
 * un-normalized prefix silently fails to match.
 *
 * The prefix can only ever arrive from caller-supplied input (`path.resolve`
 * preserves it); `realpathSync.native` cannot emit it, because libuv's
 * `fs__realpath_handle` strips it unconditionally.
 *
 * `\\?\Volume{GUID}\…` is deliberately left alone: the remainder of a volume-GUID
 * path is not a usable path, so stripping it would invent a wrong one. The `\\.\`
 * device namespace is left alone for the same reason and one more — most of what
 * it addresses (`\\.\PhysicalDrive0`, `\\.\COM1`, `\\.\pipe\…`) is not a
 * filesystem path at all. Both forms simply fail to match a registry entry, which
 * is the safe direction. `platform` is explicit so the transform is unit-testable
 * off Windows — same shape as `normalizeAnalyzerRootPath` in
 * `src/core/analyzer-identity.ts`.
 *
 * Call this on a `path.resolve`d path. Only the backslash spelling is matched,
 * which is sufficient there because `path.win32.resolve` already folds the
 * forward-slash spelling into it (`//?/D:/a` → `\\?\D:\a`). A raw, unresolved
 * `//?/…` string is returned unchanged rather than half-normalized.
 */
export declare const stripWindowsLongPathPrefix: (p: string, platform?: NodeJS.Platform) => string;
/**
 * Split `items` into consecutive slices of at most `size`.
 *
 * Returns an empty array for empty input, and never returns an empty slice, so
 * `for (const batch of chunk(xs, n))` always has something to work on.
 *
 * Callers batching a GRAPH QUERY should take the size from `core/lbug/query-batch.ts`,
 * which documents why a query built from a caller-sized array needs a ceiling at
 * all (#2915) and which of the two ceilings applies: `LBUG_QUERY_BATCH_SIZE` when
 * each item makes the query do more work, `LBUG_ID_PROBE_BATCH_SIZE` when it is a
 * plain `id IN $ids` probe and round trips dominate. They differ by 10x, in
 * opposite directions, for that reason.
 */
export declare function chunk<T>(items: readonly T[], size: number): T[][];
/**
 * Run `run` over each item with at most `concurrency` in flight, returning the
 * results in input order.
 *
 * A failure is reported through `onError` and yields `undefined` for that item,
 * so one bad item degrades the result (the caller raises its own `partial`
 * flag) instead of discarding the items that succeeded beside it.
 *
 * This SCHEDULES, it does not synchronize: `run` must be safe to execute
 * concurrently with itself. Both kinds of caller here are — `fs.readFile` per
 * path in the ingestion walkers, and graph queries, where `executeParameterized`
 * checks a connection out of the per-repo pool for the duration of the query
 * (`pool-adapter.ts`) so parallel calls never share one. The default leaves
 * headroom for other in-flight work.
 */
export declare function mapConcurrent<T, R>(items: readonly T[], run: (item: T) => Promise<R>, options?: {
    concurrency?: number;
    onError?: (error: unknown) => void;
}): Promise<(R | undefined)[]>;
