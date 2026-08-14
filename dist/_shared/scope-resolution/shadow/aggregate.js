/**
 * Shadow-mode aggregation — per-language parity %, per-evidence-kind
 * breakdown of divergences. Consumed by the parity dashboard (RING2-PKG-5).
 *
 * Pure functions; no I/O. The harness persists per-run JSON; the dashboard
 * reads `.gitnexus/shadow-parity/latest.json` and renders.
 *
 * Related types — `ShadowAgreement`, `ShadowCallsite`, `ShadowDiff` — are
 * defined alongside `diffResolutions` in `./diff.ts` and re-exported
 * through the top-level `gitnexus-shared` barrel. Consumers import all
 * three from `gitnexus-shared`, not from this module.
 *
 * Part of RFC #909 Ring 2 SHARED — #918.
 */
// ─── Public API ─────────────────────────────────────────────────────────────
/**
 * Aggregate a stream of `ShadowDiff` records into a `ShadowParityReport`,
 * bucketed by language. Pure function.
 *
 * - `perLanguage` rows are sorted alphabetically by `SupportedLanguages`
 *   value for stable JSON output (the dashboard reads
 *   `.gitnexus/shadow-parity/latest.json` and diffing snapshots is useful).
 * - `overall` is the column-wise sum across languages.
 * - `generatedAt` is injected via the `now` parameter so tests stay
 *   deterministic; production callers let it default to `new Date()`.
 */
export function aggregateDiffs(diffs, now = new Date()) {
    const perLanguageMap = new Map();
    for (const { language, diff } of diffs) {
        let counts = perLanguageMap.get(language);
        if (!counts) {
            counts = makeEmptyCounts();
            perLanguageMap.set(language, counts);
        }
        tallyDiff(counts, diff);
    }
    const perLanguage = Array.from(perLanguageMap.entries())
        .map(([language, counts]) => buildRow(language, counts))
        .sort((a, b) => a.language.localeCompare(b.language));
    const overall = buildOverallRow(perLanguage);
    return {
        generatedAt: now.toISOString(),
        perLanguage,
        overall,
    };
}
function makeEmptyCounts() {
    return {
        totalCalls: 0,
        bothAgree: 0,
        onlyLegacy: 0,
        onlyNew: 0,
        bothDisagree: 0,
        bothEmpty: 0,
        evidenceBreakdown: new Map(),
    };
}
function tallyDiff(counts, diff) {
    counts.totalCalls += 1;
    incrementAgreement(counts, diff.agreement);
    if (diff.agreement === 'both-agree' || diff.agreement === 'both-empty')
        return;
    for (const ev of diff.evidenceDelta) {
        counts.evidenceBreakdown.set(ev.kind, (counts.evidenceBreakdown.get(ev.kind) ?? 0) + 1);
    }
}
function incrementAgreement(counts, agreement) {
    switch (agreement) {
        case 'both-agree':
            counts.bothAgree += 1;
            return;
        case 'only-legacy':
            counts.onlyLegacy += 1;
            return;
        case 'only-new':
            counts.onlyNew += 1;
            return;
        case 'both-disagree':
            counts.bothDisagree += 1;
            return;
        case 'both-empty':
            counts.bothEmpty += 1;
            return;
    }
}
function buildRow(language, counts) {
    const resolved = counts.totalCalls - counts.bothEmpty;
    const parity = resolved > 0 ? counts.bothAgree / resolved : 0;
    return {
        language,
        totalCalls: counts.totalCalls,
        bothAgree: counts.bothAgree,
        onlyLegacy: counts.onlyLegacy,
        onlyNew: counts.onlyNew,
        bothDisagree: counts.bothDisagree,
        bothEmpty: counts.bothEmpty,
        parity,
        // Freeze via `new Map` on a sorted-kind copy so downstream consumers
        // can't mutate the aggregator's internal state.
        evidenceBreakdown: new Map(Array.from(counts.evidenceBreakdown.entries()).sort(([a], [b]) => a.localeCompare(b))),
    };
}
function buildOverallRow(perLanguage) {
    let totalCalls = 0;
    let bothAgree = 0;
    let onlyLegacy = 0;
    let onlyNew = 0;
    let bothDisagree = 0;
    let bothEmpty = 0;
    for (const row of perLanguage) {
        totalCalls += row.totalCalls;
        bothAgree += row.bothAgree;
        onlyLegacy += row.onlyLegacy;
        onlyNew += row.onlyNew;
        bothDisagree += row.bothDisagree;
        bothEmpty += row.bothEmpty;
    }
    const resolved = totalCalls - bothEmpty;
    const parity = resolved > 0 ? bothAgree / resolved : 0;
    return { totalCalls, bothAgree, onlyLegacy, onlyNew, bothDisagree, bothEmpty, parity };
}
//# sourceMappingURL=aggregate.js.map