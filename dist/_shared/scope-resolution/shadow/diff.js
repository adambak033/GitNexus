/**
 * Shadow-mode diff logic — RFC §6.3.
 *
 * Pure comparison logic for shadow mode. Takes two `Resolution[]` (legacy
 * DAG result + new scope-based registry result) and produces a structured
 * diff record for the parity dashboard.
 *
 * Consumed by the Ring 2 PKG shadow harness (#923), which dual-runs each
 * call through legacy + new paths, diffs results, and persists per-run JSON
 * for the parity dashboard.
 *
 * Part of RFC #909 Ring 2 SHARED — #918.
 */
// ─── Public API ─────────────────────────────────────────────────────────────
/**
 * Compare two `Resolution[]` arrays (top matches at `[0]`) and produce a
 * `ShadowDiff`. Pure function.
 *
 * Agreement rules:
 * - both arrays empty → `'both-empty'`, `evidenceDelta: []`
 * - legacy empty, new non-empty → `'only-new'`, `evidenceDelta` = new's top evidence
 * - legacy non-empty, new empty → `'only-legacy'`, `evidenceDelta` = legacy's top evidence
 * - both non-empty, same top `def.nodeId` → `'both-agree'`, `evidenceDelta: []`
 * - both non-empty, different top `def.nodeId` → `'both-disagree'`,
 *   `evidenceDelta` = symmetric difference by `ResolutionEvidence.kind`
 *   (first occurrence of a kind-only-on-legacy then kind-only-on-new; order
 *   preserved from input arrays)
 *
 * Evidence-delta rationale: callers aggregating divergences want to know
 * which signal kinds explain a disagreement. Keying on `kind` (not full
 * equality over `weight`/`note`) avoids spurious deltas when the same
 * signal fires with slightly different calibration weights on each side.
 */
export function diffResolutions(callsite, legacy, newResult) {
    const legacyTop = legacy.length > 0 ? legacy[0] : null;
    const newTop = newResult.length > 0 ? newResult[0] : null;
    const agreement = (() => {
        if (legacyTop === null && newTop === null)
            return 'both-empty';
        if (legacyTop === null)
            return 'only-new';
        if (newTop === null)
            return 'only-legacy';
        return legacyTop.def.nodeId === newTop.def.nodeId ? 'both-agree' : 'both-disagree';
    })();
    const evidenceDelta = computeEvidenceDelta(legacyTop, newTop, agreement);
    return {
        callsite,
        legacy: legacyTop,
        newResult: newTop,
        agreement,
        evidenceDelta,
    };
}
// ─── Internal helpers ───────────────────────────────────────────────────────
/**
 * Symmetric difference of two evidence arrays, keyed on
 * `ResolutionEvidence.kind`. Preserves input order: legacy-only signals
 * first (in legacy's original order), then new-only signals (in new's order).
 *
 * For `'both-agree'` / `'both-empty'` the delta is empty by contract. For
 * `'only-legacy'` / `'only-new'` one side's evidence is the delta (nothing to
 * subtract against).
 */
function computeEvidenceDelta(legacy, newResult, agreement) {
    if (agreement === 'both-agree' || agreement === 'both-empty')
        return [];
    if (agreement === 'only-legacy')
        return legacy.evidence;
    if (agreement === 'only-new')
        return newResult.evidence;
    // both-disagree: symmetric difference keyed on `kind`
    const legacyKinds = new Set(legacy.evidence.map((e) => e.kind));
    const newKinds = new Set(newResult.evidence.map((e) => e.kind));
    const onlyInLegacy = legacy.evidence.filter((e) => !newKinds.has(e.kind));
    const onlyInNew = newResult.evidence.filter((e) => !legacyKinds.has(e.kind));
    return [...onlyInLegacy, ...onlyInNew];
}
//# sourceMappingURL=diff.js.map