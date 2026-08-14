/**
 * Aggregate `receiver-unresolved` resolution outcomes into the small,
 * index-persisted summary that `impact()` / `context()` read to decide whether
 * their result is exact or a lower bound (#2744, the second half of #2708).
 *
 * **Why keyed by member name.** A dropped site's callee is unknown — that is
 * what "unresolved" means — so the drop cannot be attributed to any target
 * symbol. The one thing still known is the member NAME being invoked:
 * `Service(db).do_work()` tells us a call to something called `do_work` was
 * lost even though the receiver's type was not established. That is exactly
 * the granularity the epistemic signal needs: a query about `do_work` can
 * report its caller count as a lower bound, while a query about an unrelated
 * symbol stays exact.
 */
import type { ResolutionOutcome } from './resolution-outcome.js';
/** Cap on distinct member names persisted. Well above what a real repo
 *  produces (the whole point of the signal is that drops are the exception),
 *  but bounded so a pathological repo cannot grow the metadata file without
 *  limit. Truncation is reported, never silent — see `truncated`. */
export declare const MAX_UNRESOLVED_RECEIVER_MEMBERS = 500;
export interface UnresolvedReceiverSummary {
    /** Member name → number of call sites dropped with an untyped receiver.
     *  Capped at `MAX_UNRESOLVED_RECEIVER_MEMBERS` entries, highest count first. */
    readonly counts: Readonly<Record<string, number>>;
    /** Total dropped sites, including any beyond the cap. Always the true total,
     *  so a consumer can tell that `counts` is a sample rather than the whole. */
    readonly totalSites: number;
    /** Distinct member names beyond the cap, omitted from `counts`. Absent when
     *  nothing was dropped from the map. */
    readonly omittedNames?: number;
    /**
     * Call sites dropped whose receiver was rooted OUTSIDE the indexed program,
     * by member name — `System.out.println`, `fetch(...)`, `os.environ.*`.
     *
     * Kept SEPARATE rather than filtered away. These do not make a count a lower
     * bound (there is no in-graph node an edge could have reached), but erasing
     * them at summary time would leave the persisted artifact unable to
     * distinguish "clean index" from "76 drops we judged external" — with no
     * audit path and no way back without a re-index. That is the same collapse
     * `EpistemicCauses` exists to undo, and the judgement being recorded here is a
     * heuristic, so it must stay reversible.
     */
    readonly externalCounts?: Readonly<Record<string, number>>;
    /** Total external-rooted call sites, including any beyond the cap. */
    readonly externalSites?: number;
    /**
     * Distinct member names beyond the cap, omitted from `externalCounts`. Absent
     * when nothing was dropped from that map.
     *
     * The exact twin of `omittedNames`, and it exists for the same reason. Past
     * the cap `lookupExternalCallCount` returns `undefined` for a truncated name,
     * which is indistinguishable from "this member had no external drops" — so a
     * symbol with real boundary evidence reads as having none. One map carrying a
     * truncation marker and the other silently losing entries also made the
     * persisted artifact self-contradictory: `externalSites` would exceed the sum
     * of `externalCounts` with nothing to explain the difference.
     */
    readonly externalOmittedNames?: number;
}
/**
 * Build the summary, or `undefined` when nothing was dropped — an index with
 * no unresolved receivers stores no key at all, so `epistemic` keeps its
 * existing "exact unless proven otherwise" behaviour for every repo that
 * resolves cleanly.
 */
export declare function summarizeUnresolvedReceivers(outcomes: readonly ResolutionOutcome[]): UnresolvedReceiverSummary | undefined;
/**
 * Look up the dropped-CALL count for a member name.
 *
 * THE one place that reads `UnresolvedReceiverSummary.counts`. The map is
 * revived from JSON, so it carries `Object.prototype`: a bare
 * `counts[symName]` returns a FUNCTION for `constructor`, `toString`,
 * `valueOf`, `hasOwnProperty` and friends, and a `<= 0` guard does not catch it
 * because `Number(fn)` is `NaN` and `NaN <= 0` is false. `constructor` is an
 * ordinary member name in a code graph, so that was reachable in normal use and
 * interpolated a function into user-facing text.
 *
 * Returns `undefined` when the name was never recorded, and only ever returns a
 * finite positive number otherwise.
 */
export declare function lookupUnresolvedCallCount(summary: UnresolvedReceiverSummary | undefined, symName: string): number | undefined;
/**
 * Look up the EXTERNAL-rooted dropped-call count for a member name.
 *
 * Companion to `lookupUnresolvedCallCount`, and prototype-safe for the same
 * reason: the map is revived from JSON, so `constructor` / `toString` and
 * friends would otherwise return a function.
 */
export declare function lookupExternalCallCount(summary: UnresolvedReceiverSummary | undefined, symName: string): number | undefined;
/**
 * Report which FILES lost the most call sites to an untyped receiver (#2837).
 *
 * `summarizeUnresolvedReceivers` persists the same drops keyed by member NAME,
 * capped at 500 distinct names, and discards `filePath` — deliberately, because
 * its consumer (`impact()`'s exact-vs-lower-bound verdict) asks "is this
 * symbol's caller count trustworthy", a question about names.
 *
 * That leaves "why does THIS file resolve nothing while its sibling resolves
 * everything" unanswerable from any artifact, which is exactly what #2837 asked
 * for and could not run: comparing the drop records of two files with identical
 * declared shapes separates "receiver never typed" from "typed but no edge
 * emitted", and narrows a per-file split in one run instead of a bisect.
 *
 * A log line rather than a persisted field because nothing queries it — a
 * persisted `byFile` map would be an unread field carrying its own cap and
 * truncation semantics. When a consumer appears, `UnresolvedReceiverSummary` is
 * already a `RepoMeta` field and can carry it with no schema change.
 */
export declare function logUnresolvedReceiverFiles(outcomes: readonly ResolutionOutcome[]): void;
