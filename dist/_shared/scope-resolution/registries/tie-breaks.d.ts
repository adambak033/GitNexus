/**
 * `compareByConfidenceWithTiebreaks` — the RFC §4.2 Step 7 total order
 * over `Resolution` candidates (Ring 2 SHARED #917).
 *
 * Primary key is confidence (DESC). Remaining ties within `CONFIDENCE_EPSILON`
 * fall through a deterministic cascade so the same inputs always produce
 * the same winner, independent of insertion order.
 *
 * Tie-break cascade (per RFC Appendix B):
 *
 *   1. confidence DESC                       (primary)
 *   2. scope depth ASC                       (nearer lexical scope wins)
 *   3. MRO depth ASC                         (nearer class in hierarchy wins)
 *   4. `ORIGIN_PRIORITY` ASC                 (local > import > … > global-name)
 *   5. DefId.localeCompare                   (final deterministic tiebreaker)
 *
 * The per-candidate inputs needed beyond `Resolution.confidence` —
 * `scopeDepth`, `mroDepth`, `origin` — are supplied via a sidecar
 * `TieBreakKey` so the comparator stays pure and `Resolution` itself
 * doesn't need to carry book-keeping fields.
 */
import { type OriginForTieBreak } from '../origin-priority.js';
import type { Resolution } from '../types.js';
export declare const CONFIDENCE_EPSILON = 0.001;
/** Side-information per candidate used for secondary tie-breaks. */
export interface TieBreakKey {
    readonly scopeDepth: number;
    readonly mroDepth: number;
    readonly origin: OriginForTieBreak;
}
/**
 * Pure comparator suitable for `Array.prototype.sort`. Return value follows
 * the JavaScript convention: negative → `a` wins, positive → `b` wins.
 *
 * **Important:** `keys` is keyed by `Resolution.def.nodeId`, not by array
 * index — stable across reorderings. Missing keys fall back to neutral
 * values (`scopeDepth: 0`, `mroDepth: 0`, `origin: 'local'`), which means
 * the tie-break degrades gracefully to defId-lexicographic ordering when
 * side-info is unavailable. That keeps the total order deterministic
 * even on malformed inputs.
 */
export declare function compareByConfidenceWithTiebreaks(a: Resolution, b: Resolution, keys: ReadonlyMap<string, TieBreakKey>): number;
//# sourceMappingURL=tie-breaks.d.ts.map