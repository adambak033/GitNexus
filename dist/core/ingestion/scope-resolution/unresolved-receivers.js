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
import { createLogger } from '../../logger.js';
import { rankAndCap, lookupCount } from './summary-maps.js';
/** Cap on distinct member names persisted. Well above what a real repo
 *  produces (the whole point of the signal is that drops are the exception),
 *  but bounded so a pathological repo cannot grow the metadata file without
 *  limit. Truncation is reported, never silent — see `truncated`. */
export const MAX_UNRESOLVED_RECEIVER_MEMBERS = 500;
/**
 * Rank a name→count map and cap it at {@link MAX_UNRESOLVED_RECEIVER_MEMBERS}.
 *
 * Highest count first, name as a tiebreak so the persisted map is stable across
 * runs — an unstable ordering would churn the metadata file (and its diff) on
 * every analyze for no behavioural reason. ONE comparator, shared by the
 * in-program and external maps: two hand-copied comparators that must stay
 * identical or the artifact churns on one map and not the other is exactly the
 */
/**
 * A `receiver-unresolved` drop at a CALL site.
 *
 * ONE predicate, shared by the persisted summary and the per-file diagnostic —
 * the same contract `rankAndCap` states for its comparator. If the two ever
 * disagreed, the diagnostic would rank a different population than the artifact
 * it exists to explain.
 *
 * Call sites only: Case 0's recorder gates on the receiver's punctuation, not on
 * what the reference IS, so property reads (`d.source.kind`) and writes
 * (`x.argtypes = [...]`) arrive alongside lost method calls — measured at 25 of
 * 124 drops on the fixture corpus. Counting them made the consumer's "N call
 * sites invoking X were dropped" literally false. A missing `siteKind` counts as
 * a call: the only emitter always sets it, and erring toward `lower-bound` is
 * the safe direction for an epistemic signal.
 *
 * Receiver ORIGIN is deliberately NOT decided here — the summary routes external
 * drops into their own bucket while the diagnostic excludes them, and collapsing
 * that choice into this predicate would take it away from both callers.
 */
function isUnresolvedReceiverCall(outcome) {
    return (outcome.kind === 'suppressed' &&
        outcome.reason === 'receiver-unresolved' &&
        (outcome.siteKind === undefined || outcome.siteKind === 'call'));
}
/**
 * Build the summary, or `undefined` when nothing was dropped — an index with
 * no unresolved receivers stores no key at all, so `epistemic` keeps its
 * existing "exact unless proven otherwise" behaviour for every repo that
 * resolves cleanly.
 */
export function summarizeUnresolvedReceivers(outcomes) {
    const counts = new Map();
    const externalCounts = new Map();
    let totalSites = 0;
    let externalSites = 0;
    for (const outcome of outcomes) {
        // CALL sites only — see `isUnresolvedReceiverCall`, which the per-file
        // diagnostic shares so the two can never rank different populations.
        if (!isUnresolvedReceiverCall(outcome))
            continue;
        if (outcome.name.length === 0)
            continue;
        // Routed, not discarded. External-rooted drops (`console.log(...)`,
        // `fetch(...)`) reach code this index does not contain, so there is no node
        // an edge could have pointed at and nothing was lost — they must not hedge.
        // But they stay in the artifact under their own key so the split is
        // auditable and reversible.
        //
        // `external` is a POSITIVE determination made by `classifyReceiverOrigin`
        // from a language built-in match, never a fallthrough: a receiver the
        // classifier could not place lands in `unknown`, which counts here WITH
        // `in-program`, because assuming a completeness we cannot demonstrate is
        // the unsafe direction.
        if (outcome.receiverOrigin === 'external') {
            externalSites++;
            externalCounts.set(outcome.name, (externalCounts.get(outcome.name) ?? 0) + 1);
            continue;
        }
        totalSites++;
        counts.set(outcome.name, (counts.get(outcome.name) ?? 0) + 1);
    }
    // An index whose only drops were external-rooted still reports the split, so
    // "nothing was lost" is distinguishable from "nothing was measured".
    if (totalSites === 0 && externalSites === 0)
        return undefined;
    const { kept, omitted: omittedNames } = rankAndCap(counts, MAX_UNRESOLVED_RECEIVER_MEMBERS);
    const { kept: externalKept, omitted: externalOmittedNames } = rankAndCap(externalCounts, MAX_UNRESOLVED_RECEIVER_MEMBERS);
    return {
        counts: Object.fromEntries(kept),
        totalSites,
        ...(omittedNames > 0 ? { omittedNames } : {}),
        ...(externalSites > 0
            ? {
                externalCounts: Object.fromEntries(externalKept),
                externalSites,
                ...(externalOmittedNames > 0 ? { externalOmittedNames } : {}),
            }
            : {}),
    };
}
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
export function lookupUnresolvedCallCount(summary, symName) {
    return lookupCount(summary?.counts, symName);
}
/**
 * Look up the EXTERNAL-rooted dropped-call count for a member name.
 *
 * Companion to `lookupUnresolvedCallCount`, and prototype-safe for the same
 * reason: the map is revived from JSON, so `constructor` / `toString` and
 * friends would otherwise return a function.
 */
export function lookupExternalCallCount(summary, symName) {
    return lookupCount(summary?.externalCounts, symName);
}
/**
 * Opt-in, following the repo's established diagnostic pattern
 * (`createLogger(name, { debugEnvVar })`). Every repository in every language
 * drops SOME receivers, so emitting this at `info` unconditionally would add a
 * line to every analyze anyone ever runs — the noise ADV-6 flagged. #2837's
 * reporter turns it on deliberately:
 *
 *     GITNEXUS_DEBUG_RECEIVER_DROPS=1 gitnexus analyze
 */
// Built on first use, not at import. `createLogger` is eager where the `logger`
// singleton is a lazy Proxy — it resolves `pino-pretty`, constructs a SonicBoom
// destination and registers a `beforeExit` hook. This module is imported by
// `mcp/local/local-backend.ts` for its lookup helpers, so an eager call would
// put that on MCP server startup for a diagnostic that is off by default.
let receiverDropLog;
const dropLog = () => (receiverDropLog ??= createLogger('receiver-drops', {
    debugEnvVar: 'GITNEXUS_DEBUG_RECEIVER_DROPS',
}));
/** Files named in the per-file receiver-drop line. Bounded: this is a signpost
 *  pointing at where to look, not an inventory. */
const UNRESOLVED_RECEIVER_FILE_SAMPLE = 10;
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
export function logUnresolvedReceiverFiles(outcomes) {
    // Nothing below is observable unless the diagnostic is switched on, so skip
    // the whole tally rather than building it and discarding it at the emit.
    if (!dropLog().isLevelEnabled('debug'))
        return;
    const byFile = new Map();
    let totalSites = 0;
    for (const outcome of outcomes) {
        // External-rooted drops (`fmt.Println`) reach code this index does not
        // contain, so no node existed for an edge to point at and nothing was lost.
        // Counting them here led the ranking with files that call `fmt` the most.
        if (!isUnresolvedReceiverCall(outcome) || outcome.receiverOrigin === 'external')
            continue;
        totalSites += 1;
        byFile.set(outcome.filePath, (byFile.get(outcome.filePath) ?? 0) + 1);
    }
    if (totalSites === 0)
        return;
    const { kept } = rankAndCap(byFile, UNRESOLVED_RECEIVER_FILE_SAMPLE);
    dropLog().debug({
        totalSites,
        filesAffected: byFile.size,
        topFiles: kept.map(([filePath, sites]) => ({ filePath, sites })),
    }, 'receiver-unresolved call sites by file (top offenders; a file far above its ' +
        'siblings usually means its receivers were never typed, not that it has more calls)');
}
