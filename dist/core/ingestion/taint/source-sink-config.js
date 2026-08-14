/**
 * Source/sink/sanitizer config model (issue #2080 M0 seam, extended by #2083
 * M3 U2).
 *
 * The per-language taint configuration *shape*. M0 shipped only the bare
 * `{name, args?}` callable matcher and an empty registry seam; M3 U2 extends
 * it with the `kind` taxonomy and the resolution-mechanism fields the
 * import-aware matcher (`taint/match.ts`) needs, and fills the registry with
 * the built-in TS/JS model (`taint/typescript-model.ts`).
 *
 * Design rule: entries describe WHAT a callable is (category + how its name
 * resolves), never HOW matching works — matching semantics (import joins,
 * shadow checks, spread/template position rules) live in the matcher so the
 * spec stays declarative data that can hash into `taintModelVersion`.
 */
/**
 * Canonical deterministic ordering of {@link SinkKind} values. The single
 * source of this order — the intra-procedural propagation engine
 * (`propagate.ts`) and the M4 summary harvest (`summary-harvest.ts`) both sort
 * `neutralized`/exclusion sets by it so their deterministic outputs (and the
 * summary version stamp) stay stable. Lives here, next to the `SinkKind`
 * union, so the two consumers never drift.
 */
export const SINK_KIND_ORDER = [
    'code-injection',
    'command-injection',
    'path-traversal',
    'sql-injection',
    'xss',
];
const SINK_KIND_RANK = new Map(SINK_KIND_ORDER.map((k, i) => [k, i]));
/** Dedupe + sort sink kinds by {@link SINK_KIND_ORDER} (deterministic). */
export function sortSinkKinds(kinds) {
    return [...new Set(kinds)].sort((a, b) => (SINK_KIND_RANK.get(a) ?? 99) - (SINK_KIND_RANK.get(b) ?? 99));
}
/** Rank of a sink kind in {@link SINK_KIND_ORDER} (for comparator chaining). */
export function sinkKindRank(kind) {
    return SINK_KIND_RANK.get(kind) ?? 99;
}
