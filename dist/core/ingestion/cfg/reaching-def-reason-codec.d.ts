/**
 * REACHING_DEF reason codec (PDG FU-B-2) — the ONE shared encoder/decoder for
 * the source-level annotation carried on a persisted `REACHING_DEF` edge's
 * `reason` column.
 *
 * A `REACHING_DEF` edge is `(defBlock:BasicBlock)->(useBlock:BasicBlock)` for one
 * binding. The persisted columns (`from,to,type,confidence,reason,step`) are
 * DEDUPED to `(defBlock, useBlock, bindingIdx)` (emit.ts), so the persisted
 * edge cannot, by itself, recover the def→use chain WITHIN a coalesced
 * straight-line BasicBlock: lines 7-9 of `chainCompute` collapse to one block
 * and `a@7 -> b@8 -> c@9` become block-self edges with no line information. This
 * codec ANNOTATES each edge with the ORDERED LIST of (defLine, useLine) source
 * lines for that (block-pair, binding) group — the full set of def→use steps the
 * solver produced for it — so the statement-granular intra-block chain is
 * recoverable at projection time (pdg-impact.ts) WITHOUT widening the dedup key:
 * the edge COUNT is unchanged (still one edge per group), only the `reason`
 * carries the pair LIST (RD/taint substrate + cfg-bench budgets protected — the
 * cfg-bench canon does not include the persisted `reason`).
 *
 * Carrying the FULL list (not just the FIRST pair) is what makes a SAME-BINDING
 * reassignment chain recoverable: `acc = f(acc); acc = g(acc); acc = h(acc)`
 * coalesces into one block, and ALL of `acc@24->acc@25`, `acc@25->acc@26`,
 * `acc@26->acc@27` share the one `(self-block, self-block, accIdx)` group. A
 * first-pair-only annotation could chain `24->25` but never reach `26`; the full
 * list lets the projection walk the whole chain to fixpoint.
 *
 * ## Wire format (version `1`)
 *
 * ```
 * <name>                                       (legacy / pre-FU-B-2 — bare name)
 * <name>|1:<d1>:<u1>                           (FU-B-2, single pair)
 * <name>|1:<d1>:<u1>;<d2>:<u2>;...             (FU-B-2, ordered pair LIST)
 * ```
 *
 * The binding NAME comes FIRST, verbatim, so the established read paths keep
 * working with a trivial change: `pdg_query` mode:'flows' filters the variable
 * by `r.reason = $variable OR r.reason STARTS WITH $variable|` and projects the
 * name via {@link decodeReachingDefReason}. Source identifiers never contain `|`
 * (the structural separator), so the name is unambiguously the substring before
 * the first `|`; an un-annotated reason has no `|` and decodes to itself with no
 * line info. Within the annotation, `;` separates pairs and `:` separates the
 * version + the two lines of each pair. `<defLine>`/`<useLine>` are 1-based
 * decimal source lines.
 *
 * ## Delimiter / round-trip discipline (mirrors call-summary-codec KTD6)
 *
 * Every structural character (`|`, `:`, `;`, the version digit, decimal digits)
 * is printable ASCII, so the encoding survives `escapeCSVField ∘ sanitizeUTF8`
 * (csv-generator.ts) byte-exact. The decoder NEVER throws — anything not a
 * well-formed version-`1` annotation degrades to "name only, no pairs" (the sound
 * default: the projection then falls back to block-start granularity exactly as
 * before FU-B-2). A malformed individual pair within an otherwise-well-formed
 * list is dropped; the well-formed pairs are kept.
 */
/** One-character format version prefix. Bump on any wire-format change. */
export declare const REACHING_DEF_REASON_CODEC_VERSION = "1";
/** One def→use source-line step within a coalesced block's self chain. */
export interface DefUseLinePair {
    /** 1-based def source line. */
    readonly defLine: number;
    /** 1-based use source line. */
    readonly useLine: number;
}
/** A decoded REACHING_DEF reason. `pairs` is empty for a legacy (un-annotated)
 * reason. `defLine`/`useLine` mirror the FIRST pair for back-compat consumers. */
export interface DecodedReachingDefReason {
    /** The source-level binding name (always present — the legacy payload). */
    readonly name: string;
    /**
     * The ordered list of (defLine, useLine) steps the FU-B-2 annotation carries.
     * Empty for a legacy / malformed / un-annotated reason.
     */
    readonly pairs: readonly DefUseLinePair[];
    /** 1-based def source line of the FIRST pair (back-compat; absent if none). */
    readonly defLine?: number;
    /** 1-based use source line of the FIRST pair (back-compat; absent if none). */
    readonly useLine?: number;
}
/**
 * Encode a binding name + its ordered (defLine, useLine) step list into the
 * versioned `reason` wire string. Deterministic; never throws. Malformed /
 * negative pairs are dropped (defensive — the solver always passes 1-based
 * integers); if NO valid pair survives the result degrades to the bare name
 * (legacy form) so a malformed annotation never fabricates bad lines. The name
 * is written verbatim FIRST (see the module doc), so a name that —
 * pathologically — already contains `|` would be re-decoded with a truncated
 * name; binding names are source identifiers, which never contain `|`, so this
 * cannot occur for real input (and would only lose line precision, never corrupt
 * the substrate).
 */
export declare function encodeReachingDefReasonPairs(name: string, pairs: ReadonlyArray<DefUseLinePair>): string;
/**
 * Single-pair convenience over {@link encodeReachingDefReasonPairs} — kept for
 * call sites and tests that carry exactly one def→use step.
 */
export declare function encodeReachingDefReason(name: string, defLine: number, useLine: number): string;
/**
 * Decode a REACHING_DEF `reason` wire string into its binding name + (when
 * present) the FU-B-2 def/use source-line pair LIST. Never throws — a non-string,
 * an un-annotated bare name, or a malformed annotation all yield `{ name, pairs:
 * [] }` (the sound default: the consumer falls back to block-start granularity).
 * A well-formed `<name>|1:<d1>:<u1>;<d2>:<u2>;...` yields every well-formed pair
 * (a single malformed pair is dropped, the rest kept); `defLine`/`useLine` mirror
 * the first pair for back-compat consumers.
 */
export declare function decodeReachingDefReason(reason: unknown): DecodedReachingDefReason;
