/**
 * Pure intra-procedural taint propagation engine (#2083 M3 U3).
 *
 * Forward taint reachability over one function's reaching-definition facts
 * (M2 `computeReachingDefs`) and matched taint sites (U2 `matchFunctionSites`)
 * — sources in, findings + sanitizer kills + coverage status out. PURE AND
 * DETERMINISTIC, mirroring the reaching-defs contract: no graph, no I/O, no
 * logger; insertion-ordered worklist; explicitly sorted outputs; snapshot
 * tests and content-derived edge ids (U4) rely on it.
 *
 * PRECONDITIONS: the caller gates the CFG through `hasTaintSafeSites`
 * (taint/site-safety.ts) and the emit-safety checks before calling — this
 * module dereferences binding/site/statement indices without re-validating.
 *
 * ## The two-rule model (plan HTD)
 *
 * - **Rule (b), statement-local:** a matched SOURCE occurrence (member read)
 *   whose intra-statement occurrence path — the member-read's `parent` chain —
 *   reaches a matched SINK argument position produces an immediate single-hop
 *   finding (`exec(req.body)`). The same statement SEEDS taint: every binding
 *   the statement defines becomes tainted (see the precision floor below).
 * - **Rule (a), worklist:** for each tainted `(binding, defPoint)`, every
 *   def→use fact delivers the taint to a use statement, where occurrences of
 *   the binding in matched sink argument positions produce findings and the
 *   statement's own defs are tainted onward. The fact graph contains genuine
 *   cycles (loop back-edges, same-statement self-facts) — the visited-set
 *   discipline below is load-bearing, not defensive.
 *
 * ## Sanitizer semantics — the KIND-SET exclusion model (KTD4, sharpened)
 *
 * The plan sketches a binary kill; this module implements the strictly more
 * precise SOUND refinement: a taint carries a set of *excluded* (neutralized)
 * `SinkKind`s accumulated through sanitizer hops, and a sink fires unless its
 * kind is in the taint's exclusion set. A binary kill is the special case
 * where the sanitizer neutralizes the sink's kind; the kind-set model
 * additionally keeps `const b = escape(req.body); db.query(b)` a FINDING
 * (an HTML escaper does not neutralize SQL — un-tainting `b` outright would
 * be a suppressed live injection, the forbidden false-negative direction)
 * while still suppressing `res.send(b)` (xss IS neutralized).
 *
 * - **Occurrence interposition (KTD4a):** evaluated over the U1 site
 *   structure. An occurrence reaching a sink arg / def-feeding position
 *   through a matched sanitizer site accumulates that sanitizer's
 *   `neutralizes` kinds on that PATH; a direct occurrence contributes the
 *   empty set. Per-position narrowing (`entry.args`) is respected; receiver
 *   flow through a sanitizer is NOT neutralized (the receiver is not the
 *   sanitized payload), and spread/template positions are never neutralized
 *   (position unprovable) — both sound-direction choices (under-kill).
 * - **Intersection over paths:** a def fed by several occurrence paths
 *   excludes a kind only when EVERY path neutralizes it
 *   (`const c = cond ? escape(b) : b` taints `c` with NO exclusions — the
 *   direct arm's ∅ intersects everything away). Equally, a taint re-derived
 *   along a second route keeps the INTERSECTION of the exclusion sets and is
 *   re-processed whenever the set SHRINKS — a less-neutralized taint is
 *   strictly more dangerous. Exclusion sets only shrink over a finite
 *   lattice, so the worklist terminates.
 * - **Kill locality (KTD4b):** a kill applies to the def the sanitizer
 *   produces (`SiteRecord.resultDefs`) only; the flowing binding's own taint
 *   is untouched (`const c = escape(b); exec(b)` still finds `b`'s flow).
 *   `x = escape(x)` works because taint keys on the DEF POINT: the
 *   sanitizer statement's def enters the set with the sanitizer's kinds
 *   excluded, while the seed def keeps flowing wherever the CFG still
 *   carries it (zero-iteration loops, conditional sanitizers — may-path
 *   mechanics need no special handling here, kills are absent from facts).
 *
 * ## Statement-coalescing precision floor (documented FP)
 *
 * Statement facts conflate multi-declarator statements: a statement that
 * uses tainted `b` and defines `c` taints `c` with NO exclusions even when
 * the two are textually unrelated (`const a = clean(z), b = g(t)` floor-
 * taints `a` from `t` — pinned by a test). The per-declarator `resultDefs`
 * precision narrows the EXCLUSION computation (and powers kills) only — a
 * def in a call's `resultDefs` is fed exactly through that call, so its
 * exclusions come from the paths into it; when the tainted input provably
 * never flows into that call, the floor still taints the def (sound) but
 * records no kill (a kill requires evidence of flow through the sanitizer).
 *
 * ## Propagate-through (KTD5)
 *
 * Taint in any argument or in the receiver of an UNMODELED call flows to
 * the call's result defs, marked `viaCall` on the hop so `explain` can
 * express lower confidence. An occurrence that reaches the unmodeled call
 * only through a sanitizer carries the neutralization through
 * (`const y = unknownFn(escape(b))` excludes the sanitizer's kinds — the
 * plan's deliberate precision choice over flat-conservative).
 *
 * ## Kills output
 *
 * `kills` records every sanitizer that ACTUALLY neutralized kinds on a
 * flowing taint — U4 emits `SANITIZES` edges from them. Two shapes share the
 * record: result-def kills (`killedDef` = the def the sanitizer produces;
 * `bindingIdx` = that def's binding) and value-position interposition kills
 * (`exec(escape(x))` — no def exists; `killedDef` = the sink statement's own
 * point, `bindingIdx` = the interposed binding). Interposition kills are
 * recorded only when the (input, sink, position) produced no finding — a
 * bypassed sanitizer (`exec(x + escape(x))`) killed nothing.
 */
import type { FunctionCfg } from '../cfg/types.js';
import type { FunctionDefUse, ProgramPoint } from '../cfg/reaching-defs.js';
import type { FunctionSiteMatches } from './match.js';
import { type SinkKind, type SourceKind } from './source-sink-config.js';
/**
 * Default per-function findings cap (U5 config resolution; cfg/emit.ts
 * DEFAULT_* pattern). Resolved into the RepoMeta `pdg` stamp by
 * `resolvePdgConfig` so a cap change trips full writeback; `0` = unlimited
 * is preserved like the other pdg caps. 200 is generous — a real function
 * with more deduped source→sink findings is a fixture or a disaster, and
 * the truncation is deterministic + counted (`droppedFindings`).
 */
export declare const DEFAULT_PDG_MAX_TAINT_FINDINGS_PER_FUNCTION = 200;
/**
 * Default per-finding hop cap (U5; joins the RepoMeta `pdg` stamp like the
 * findings cap). Bounds the persisted `reason` hop encoding (KTD6 pins the
 * hop cap in config); 32 intra-procedural def→use hops is far beyond any
 * legible path — overflow keeps the source-side prefix and sets
 * `hopsTruncated`, parsed downstream as "path incomplete", never an error.
 */
export declare const DEFAULT_PDG_MAX_TAINT_HOPS = 32;
export interface TaintLimits {
    /**
     * Maximum findings per function AFTER dedup; the sorted finding list is
     * truncated deterministically and the overflow counted in
     * `droppedFindings`. `undefined`/0 ⇒ unlimited.
     */
    readonly maxFindingsPerFunction?: number;
    /**
     * Maximum hops retained per finding (source-side prefix kept); overflow
     * sets `hopsTruncated`. `undefined`/0 ⇒ unlimited.
     */
    readonly maxHops?: number;
}
/** One hop of a finding's path — enough for U4's reason codec (name, line, flag). */
export interface TaintHop {
    /** Index into the function's binding table. */
    readonly bindingIdx: number;
    /** Resolved binding name (carried so U4 never re-joins the table). */
    readonly name: string;
    readonly point: ProgramPoint;
    /** The value passed through an unmodeled call to get here (KTD5). */
    readonly viaCall?: boolean;
}
/**
 * The source identity material for a finding: either the matched member-read
 * occurrence itself (statement point + site index + object/property) or an
 * assigned call-result source. For worklist findings this is the ROOT source
 * the taint chain was seeded from.
 */
interface BaseSourceOccurrence {
    readonly point: ProgramPoint;
    /** Index into the source statement's `sites` array. */
    readonly siteIndex: number;
    readonly type: 'member-read' | 'call-result';
    readonly kind: SourceKind;
}
interface MemberReadSourceOccurrence extends BaseSourceOccurrence {
    readonly type: 'member-read';
    readonly objectBindingIdx: number;
    readonly property: string;
}
interface CallResultSourceOccurrence extends BaseSourceOccurrence {
    readonly type: 'call-result';
    readonly resultBindingIdx: number;
    readonly calleeName: string;
}
export type TaintSourceOccurrence = MemberReadSourceOccurrence | CallResultSourceOccurrence;
/** The sink side of a finding's identity: point + site + argument + binding. */
export interface TaintSinkOccurrence {
    readonly point: ProgramPoint;
    /** Index into the sink statement's `sites` array. */
    readonly siteIndex: number;
    /** Matched sink argument position the tainted occurrence landed in. */
    readonly argIndex: number;
    /**
     * The binding whose occurrence reached the sink position (for rule-(b)
     * findings: the source member-read's object binding).
     */
    readonly bindingIdx: number;
    /** The matched sink entry's `name` (e.g. `exec`) — finding classification. */
    readonly entryName: string;
}
export interface TaintFinding {
    readonly sinkKind: SinkKind;
    readonly source: TaintSourceOccurrence;
    readonly sink: TaintSinkOccurrence;
    /**
     * Ordered source→sink path, one path per finding (the CodeQL
     * `--max-paths=1` convention): the taint chain's def hops followed by the
     * sink-use hop. Rule-(b) findings carry the single sink-statement hop.
     */
    readonly hops: readonly TaintHop[];
    readonly hopsTruncated?: boolean;
}
/** A sanitizer that neutralized kinds on a flowing taint — U4's SANITIZES rows. */
export interface SanitizerKill {
    /** Statement point of the sanitizer call site. */
    readonly sanitizer: ProgramPoint;
    /**
     * The killed def's point (result-def kills — always the sanitizer's own
     * statement in the intra-statement model) or the suppressed sink
     * statement's point (value-position interposition kills).
     */
    readonly killedDef: ProgramPoint;
    /** The killed def's binding, or the interposed binding for value-position kills. */
    readonly bindingIdx: number;
    /** Sorted, deduped kinds the sanitizer neutralized at that position. */
    readonly neutralized: readonly SinkKind[];
}
export interface FunctionTaintResult {
    /**
     * `computed`     — full propagation ran.
     * `coverage-gap` — the solver result was not `computed`; the function is
     *                  skipped for findings entirely (R4: never partially
     *                  analyzed), `gapReason` carries the solver status.
     */
    readonly status: 'computed' | 'coverage-gap';
    readonly gapReason?: 'truncated' | 'overflow' | 'no-facts';
    /** Deduped (KTD6 identity), deterministically sorted, capped. */
    readonly findings: readonly TaintFinding[];
    readonly kills: readonly SanitizerKill[];
    /** Findings dropped by `maxFindingsPerFunction` (post-dedup). */
    readonly droppedFindings: number;
}
/**
 * Compute taint flows for one function. See the module doc for the two-rule
 * model, the kind-set exclusion semantics, and the precision floor.
 */
export declare function computeTaintFlows(cfg: FunctionCfg, defUse: FunctionDefUse, matches: FunctionSiteMatches, limits?: TaintLimits): FunctionTaintResult;
export {};
