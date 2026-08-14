import { rankAndCap } from './summary-maps.js';
/** Twin of `MAX_UNRESOLVED_RECEIVER_MEMBERS`, same rationale. Truncation is
 *  reported, never silent — see `totalInterfaces` / `omittedCandidates`. */
export const MAX_UNDECIDED_INTERFACES = 500;
/** Returns `undefined` when nothing was undecided: absence means "this run
 *  decided everything it looked at", which must stay distinguishable from a
 *  zeroed record at read time. */
export function summarizeUndecidedSatisfaction(undecided) {
    if (undecided.length === 0)
        return undefined;
    const byName = new Map();
    const byCandidate = new Map();
    let totalCandidates = 0;
    for (const entry of undecided) {
        totalCandidates += entry.undecidedCandidates;
        byName.set(entry.interfaceName, (byName.get(entry.interfaceName) ?? 0) + entry.undecidedCandidates);
        for (const candidate of entry.candidateNames) {
            byCandidate.set(candidate, (byCandidate.get(candidate) ?? 0) + 1);
        }
    }
    // Highest count first, name as tiebreak. The tiebreak is load-bearing, not
    // cosmetic: past the cap it decides WHICH entries survive, and a
    // locale-sensitive comparison would make the persisted file depend on the
    // machine that wrote it.
    const ranked = rankAndCap(byName, MAX_UNDECIDED_INTERFACES);
    const candidates = rankAndCap(byCandidate, MAX_UNDECIDED_INTERFACES);
    return {
        counts: Object.fromEntries(ranked.kept),
        // `totalInterfaces` minus the kept keys IS the omitted count, so only the
        // total is persisted — unlike the sibling summary, which has no total to
        // derive it from and therefore carries the omission explicitly.
        totalInterfaces: ranked.kept.length + ranked.omitted,
        totalCandidates,
        candidateCounts: Object.fromEntries(candidates.kept),
        ...(candidates.omitted > 0 ? { omittedCandidates: candidates.omitted } : {}),
    };
}
