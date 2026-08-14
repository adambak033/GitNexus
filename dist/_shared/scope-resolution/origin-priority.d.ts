/**
 * `ORIGIN_PRIORITY` — RFC Appendix B (authoritative values).
 *
 * Tie-break ordering applied inside `Registry.lookup` Step 7 when
 * `|Δconfidence| < 0.001` between two `Resolution` candidates. Lower number
 * = stronger (wins the tie).
 *
 * Full tie-break order (§4.2 Step 7):
 *   confidence DESC → scope depth ASC → MRO depth ASC → ORIGIN_PRIORITY ASC
 *   → DefId.localeCompare
 */
export type OriginForTieBreak = 'local' | 'import' | 'reexport' | 'namespace' | 'wildcard' | 'global-qualified' | 'global-name';
export declare const ORIGIN_PRIORITY: Readonly<Record<OriginForTieBreak, number>>;
//# sourceMappingURL=origin-priority.d.ts.map