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
import type { SupportedLanguages } from '../../languages.js';
import type { ResolutionEvidence } from '../types.js';
import type { ShadowDiff } from './diff.js';
export interface LanguageParityRow {
    readonly language: SupportedLanguages;
    readonly totalCalls: number;
    readonly bothAgree: number;
    readonly onlyLegacy: number;
    readonly onlyNew: number;
    readonly bothDisagree: number;
    readonly bothEmpty: number;
    /**
     * Fraction in [0, 1]. Numerator = `bothAgree`; denominator = "calls where
     * at least one side resolved" = `totalCalls - bothEmpty`.
     *
     * When the denominator is 0 (all calls for this language were
     * `both-empty`), returns 0. Callers rendering the dashboard should treat
     * a 0 parity alongside `totalCalls === bothEmpty` as "no signal" rather
     * than "total disagreement".
     */
    readonly parity: number;
    /**
     * Divergence signals broken down by `ResolutionEvidence.kind`. Sourced
     * from `ShadowDiff.evidenceDelta` on non-agreeing rows only — `both-agree`
     * and `both-empty` do not contribute.
     */
    readonly evidenceBreakdown: ReadonlyMap<ResolutionEvidence['kind'], number>;
}
export interface ShadowParityReport {
    readonly generatedAt: string;
    readonly perLanguage: readonly LanguageParityRow[];
    readonly overall: Omit<LanguageParityRow, 'language' | 'evidenceBreakdown'>;
}
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
export declare function aggregateDiffs(diffs: readonly {
    readonly language: SupportedLanguages;
    readonly diff: ShadowDiff;
}[], now?: Date): ShadowParityReport;
//# sourceMappingURL=aggregate.d.ts.map