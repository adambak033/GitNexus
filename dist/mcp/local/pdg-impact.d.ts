/**
 * PDG-backed impact helpers.
 *
 * Extracted from `local-backend.ts` so LocalBackend owns dispatch/repo lifecycle
 * while this module owns the PDG layer probe, statement traversal, block
 * projection, and result assembly contract.
 */
import type { executeParameterized } from '../../core/lbug/pool-adapter.js';
import { loadMeta } from '../../storage/repo-manager.js';
/**
 * Parse the `<fnLine>` segment out of a `BasicBlock` id (1-based function start
 * line). The id template is
 *   `BasicBlock:<filePath>:<fnLine>:<fnCol>:<blockIdx>`
 * and `<filePath>` may itself contain `':'` (a Windows drive letter), so the
 * segments are taken from the RIGHT: `<blockIdx>` is last, `<fnCol>` second-last,
 * `<fnLine>` third-last. Extracted from the `_pdgQueryImpl` closure (#2086) into
 * a shared module-scope helper so the PDG impact traversal (U3/U4) reuses the
 * exact same parse — the `pdg_query` read path is byte-identical to before.
 */
export declare function fnLineOf(id: string): number;
/**
 * Ids-only view of {@link parseCalleeIdsCell}. Exported (U1) so the two callers —
 * `LocalBackend.calleeIdsOfBlocks` (the statement-precise bridge key) and the
 * inter-procedural descent — cannot diverge on the split-and-drop-sentinel logic.
 * Both consume rows of `BasicBlock.calleeIds`; this is the single source.
 */
export declare function splitCalleeIds(raw: unknown): string[];
/**
 * Contract version of the mode:'pdg' impact result shape. A stable discriminator
 * for external MCP/agent consumers — distinct from the DB schema fingerprint.
 * Bump on any breaking change to the PDG result fields.
 * v2: `startLine` in the result is now 1-based display (#2380), matching the
 * context/query/impact tools (was 0-based).
 */
export declare const PDG_RESULT_VERSION: 2;
/** A reachable dependence block resolved to its source statement. */
export interface PdgStatement {
    /** 1-based source line where the statement's block starts. */
    line: number;
    /** Repo-relative file path (parsed from the block id). */
    filePath: string;
    /** The statement's source text (BasicBlock.text), trimmed. */
    text: string;
    /**
     * Whether the statement belongs to the criterion's OWN function (`'intra'`)
     * or was reached across a call boundary (`'inter'`). A block is `'intra'`
     * iff its owning-fn file AND 1-based owning-fn start line both match the
     * criterion's — `fnFileOf(id) === criterionFile && fnLineOf(id) === ownerFnLine`.
     * Projection-only tag (FU-A): NOT persisted, NOT a schema field. The bench
     * intra axis scopes to `'intra'` statements so U1's cross-function reach
     * stops being counted as intra-axis false positives; existing consumers
     * ignore it.
     */
    scope: 'intra' | 'inter';
}
export interface PdgImpactTarget {
    name: string;
    id?: string;
    type?: string;
    filePath?: string;
}
export interface PdgImpactParityFields {
    byDepth: Record<number, unknown[]>;
    byDepthCounts: Record<number, number>;
    summary: {
        direct: number;
        processes_affected: number;
        modules_affected: number;
    };
    affected_processes: unknown[];
    affected_modules: unknown[];
}
export type PdgImpactEvidence = 'local-dependence' | 'owner-projection' | 'callgraph-bridge' | 'unproven-bridge' | 'degraded';
/**
 * WHY the callee set the descent EXAMINED for `CALL_SUMMARY` return-flows is a
 * strict PREFIX of the slice's real callee list. A STRUCTURED vocabulary, in the
 * spirit of `truncatedByReasons: readonly ('depth'|'limit')[]` — the codes are the
 * contract, the English phrasing is a rendering of them
 * ({@link ASCENT_INCOMPLETE_PHRASE}). A caller branches on the code; only the note
 * reads the phrase, so a rewording can never break a consumer.
 *  - `'traversal-truncated'` — the traversal stopped at its depth/size budget, so
 *    a callee that DOES carry a return-flow can sit in a hop never reached (the
 *    same fact the result's `truncated`/`truncatedByReasons` report, read at the
 *    ascent's granularity).
 *  - `'callee-list-capped'` — a slice block's `calleeIds` cell was capped at emit;
 *    `parseCalleeIdsCell` strips the sentinel, so the dropped ids are invisible to
 *    BOTH the summary scan and the counters.
 *  - `'callee-ids-unrecorded'` — a slice block records CALL SITES (a non-empty
 *    `callees` name cell) but NO resolved callee ids. An empty `calleeIds` cell
 *    carries no sentinel, so those call sites are invisible to the summary scan
 *    without raising `'callee-list-capped'`. Distinct from the cap: nothing was
 *    dropped at emit — the ids were never recorded.
 *
 *    THREE producer paths yield it, and the consumer cannot tell them apart —
 *    do not read this code as naming any one of them (`cfg/emit.ts`,
 *    `calleeIdsOfBlock`):
 *      1. the file's resolved-id map is absent entirely (`fileMap === undefined`);
 *      2. a call site has no position anchor;
 *      3. a call site's position IS in the map but did not RESOLVE.
 *    (3) is the ordinary one — it is exactly the receiver-resolution gaps this
 *    repo pins (e.g. #2807's inference-typed field receivers, where `calleeIds`
 *    empties while `calleesOfBlock` still writes the leaf names). So on a real
 *    index this fires broadly and is driven by resolution quality, NOT by a
 *    missing `--pdg` layer: "re-run analyze --pdg" is the wrong remedy for it,
 *    and `examinedComplete: false` here is a statement about how much of the
 *    call graph resolved, not about the traversal giving up.
 *
 *    Consequence worth knowing before branching on it: because (3) is common,
 *    `examinedComplete: true` is the strong, rare signal and `false` is close to
 *    the default on a large repo. Distinguishing the three needs a marker at
 *    emit time, which would move the persisted cell format — deliberately out of
 *    scope here, and tracked separately.
 */
export type PdgAscentIncompleteReason = 'traversal-truncated' | 'callee-list-capped' | 'callee-ids-unrecorded';
/**
 * Return-value-ascent coverage, published on {@link PdgImpactEvidenceSummary} so a
 * consumer can answer "was the ascent complete, and if not why" WITHOUT parsing
 * the result `note`. This is MCP output read by agents: the same four facts are
 * also narrated in the note (see {@link AscentCoverage} for the canonical
 * rationale, and `assemblePdgImpactResult` for the single site that renders both
 * from one computation), and the prose is the human surface, not the contract.
 *
 * Present iff the inter-procedural descent RAN (a downstream slice that reached
 * the assembly path). Absent ⇒ nothing was scanned — deliberately not a zeroed
 * object, which would read as "we looked and found nothing".
 */
export interface PdgAscentCoverage {
    /**
     * Count of DISTINCT callee ids scanned for a `CALL_SUMMARY` — a distinct-callee
     * tally, NOT a call-site count: two slice blocks invoking the same callee
     * contribute 1, and one block invoking it twice also contributes 1. That is the
     * correct population for the claim `returnFlowFound` makes, because a
     * `CALL_SUMMARY` is a property of the CALLEE, not of the call site.
     *
     * Callee granularity, NOT "callees resolved to a body": a cell's ids that
     * `resolveCalleeSpans` never matches (out-of-repo target, interface method, the
     * `Class:` id a `new` expression contributes) are scanned all the same. See
     * {@link AscentCoverage} POPULATION. (The field NAME is historical — the
     * published shape is versioned by `pdgResultVersion`, so it is kept while the
     * prose on both surfaces says "distinct callees".)
     */
    referencesScanned: number;
    /**
     * Whether ANY scanned callee carried a DECODED non-empty return-flow — i.e.
     * whether the ascent FIRED anywhere in this slice. `false` with
     * `referencesScanned > 0` is the structural counterpart of the note's
     * "no return-value ascent in this slice" sentence.
     */
    returnFlowFound: boolean;
    /**
     * Scanned callees whose `CALL_SUMMARY` the codec could not decode (version skew
     * / corruption / NULL reason). Each withholds the ascent exactly like an empty
     * summary, so a non-zero count means `returnFlowFound: false` is NOT a statement
     * about what the persisted summaries record — remedy: re-run `analyze --pdg`.
     */
    undecodableSummaryCount: number;
    /**
     * Whether {@link referencesScanned} ranges over EVERY callee the descent's slice
     * blocks recorded a resolved id for. `false` ⇒ the counters above range over a
     * strict subset, so `returnFlowFound: false` is not a whole-slice claim. Reasons
     * in {@link incompleteReasons}.
     *
     * SCOPE — the population is "callees the INDEX recorded resolved ids for on the
     * blocks the DESCENT visited", never "every call the source text makes". Two
     * gaps are named structurally rather than assumed away: a block whose ids the
     * emitter capped raises `'callee-list-capped'`, and a block that records call
     * sites but no ids at all raises `'callee-ids-unrecorded'`. What is NOT modelled
     * (and cannot be, from the persisted graph) is a call the CFG never materialised
     * as a call site — so `true` means "nothing the index recorded was skipped", not
     * "the program makes no other calls".
     */
    examinedComplete: boolean;
    /** Empty iff {@link examinedComplete}; otherwise every mechanism that fired. */
    incompleteReasons: readonly PdgAscentIncompleteReason[];
    /**
     * Whether the index carries the `CALL_SUMMARY` layer at all. `false` ⇒ a PRE-FU-C
     * (v3) `--pdg` index, where the scan COULD NOT have found a return-flow — without
     * this a consumer would read `returnFlowFound: false` as "these callees record no
     * return-flow" when the truth is "the layer that records it does not exist here"
     * (the note distinguishes the two in prose; this keeps the structured surface
     * from being false-safe). Remedy: re-run `analyze --pdg`.
     *
     * READING IT WITH THE OTHER FIELDS. `{referencesScanned: N>0, returnFlowFound:
     * false, callSummaryLayerPresent: false}` is SELF-CONSISTENT and expected on a
     * v3 index, not a contradiction: the scan really did run over N callees and
     * really did find nothing, because there was no layer in which a return-flow
     * could be recorded. Read this field FIRST — while it is `false`,
     * `returnFlowFound` and `undecodableSummaryCount` say nothing about the callees
     * themselves and must not be used to conclude "no callee returns a
     * slice-dependent value". `examinedComplete` is orthogonal to all of this: it
     * reports coverage of the callee POPULATION, never the presence of the layer.
     */
    callSummaryLayerPresent: boolean;
}
export interface PdgImpactEvidenceSummary {
    statements?: PdgImpactEvidence;
    localSymbols?: PdgImpactEvidence;
    interprocedural?: PdgImpactEvidence;
    localSymbolCount?: number;
    unresolvedBlockCount?: number;
    ambiguousProjectionCount?: number;
    interproceduralEvidenceCounts?: Partial<Record<PdgImpactEvidence, number>>;
    /**
     * Return-value-ascent coverage — the same "counts + classification" kind as the
     * three counters above, scoped to the U-C4 ascent. Optional because the descent
     * does not run for every slice; see {@link PdgAscentCoverage}.
     */
    ascent?: PdgAscentCoverage;
}
export interface PdgInterproceduralImpact {
    engine: 'symbol-graph';
    evidence: Extract<PdgImpactEvidence, 'callgraph-bridge' | 'unproven-bridge'>;
    impactedCount: number;
    byDepthCounts: Record<number, number>;
    byDepth: Record<number, unknown[]>;
    evidenceCounts?: Partial<Record<PdgImpactEvidence, number>>;
    /**
     * Statement-precise (proven) subset of `byDepth` — additive. Tighter than
     * `byDepth` for a line-seeded downstream slice (drops `unproven-bridge`
     * symbols not invoked from the dependence slice), equal to it otherwise.
     * `statementPrecision` = |proven| / |reach| (null when there is no reach).
     */
    statementPreciseByDepth?: Record<number, unknown[]>;
    statementPreciseByDepthCounts?: Record<number, number>;
    statementPreciseImpactedCount?: number;
    statementPrecision?: number | null;
    partial: boolean;
}
export interface PdgImpactBaseResult extends PdgImpactParityFields {
    mode: 'pdg';
    /** Contract version of the mode:'pdg' impact result shape; bump on any breaking change to the PDG result fields. */
    pdgResultVersion: 2;
    target: PdgImpactTarget;
    direction: 'upstream' | 'downstream';
    impactedCount: number;
    risk: 'UNKNOWN';
    note?: string;
    partial?: boolean;
    interproceduralByDepth?: Record<number, unknown[]>;
    interproceduralByDepthCounts?: Record<number, number>;
    interproceduralEpistemic?: string;
    interproceduralBoundaries?: unknown[];
    interproceduralError?: string;
    pdgInterprocedural?: PdgInterproceduralImpact;
    pdgEvidence?: PdgImpactEvidenceSummary;
}
/**
 * Slice-result fields shared verbatim by {@link PdgImpactSuccessResult} and
 * {@link PdgImpactEmptyResult}. Those two differ ONLY in their `epistemic`
 * discriminant (and the narrowed `target`, which must be re-declared on each to
 * override `PdgImpactBaseResult.target`), so every other slice field lives here
 * to keep the two in lockstep — a new slice field is added once, not twice.
 */
export interface PdgImpactSliceFields {
    reachableBlocks: string[];
    /**
     * INTRA-procedural reachable subset of `reachableBlocks` (the statement slice
     * BEFORE the U1 inter-procedural descent expanded it). The callgraph bridge
     * keys its "first-hop proven" set on this, NOT the interproc-expanded
     * `reachableBlocks` superset, so statementPrecision keeps its first-hop meaning
     * (FIX 6). Equals `reachableBlocks` when no hop crossed; empty for the
     * no-body / no-block-at-line empty returns.
     */
    intraReachableBlocks: string[];
    /** The criterion's own seed blocks (changed statement / whole-symbol body). */
    seedBlocks: string[];
    blockCount: number;
    affectedStatements: PdgStatement[];
    affectedStatementCount: number;
    depthReached: number;
    unresolvedBlockCount: number;
    ambiguousProjectionCount: number;
    criterionLine?: number;
    truncated?: boolean;
    truncatedBy?: 'depth' | 'limit';
    truncatedByReasons?: readonly ('depth' | 'limit')[];
}
export interface PdgImpactSuccessResult extends PdgImpactBaseResult, PdgImpactSliceFields {
    target: Required<PdgImpactTarget>;
    epistemic: 'pdg-intra-procedural';
}
export interface PdgImpactEmptyResult extends PdgImpactBaseResult, PdgImpactSliceFields {
    target: Required<PdgImpactTarget>;
    epistemic: 'no-pdg-body' | 'pdg-no-block-at-line' | 'pdg-intra-procedural';
}
export type PdgDegradedLayerState = Exclude<PdgLayerStatus['state'], 'ready'>;
export type PdgDegradedLayerStatus = PdgLayerStatus & {
    state: PdgDegradedLayerState;
};
export interface PdgImpactDegradedResult extends PdgImpactBaseResult {
    pdgLayer: PdgDegradedLayerState;
    missingSubLayer?: PdgSubLayer;
    probeError?: string;
    recoverySuggestion?: string;
}
export interface PdgImpactErrorResult {
    mode?: 'pdg';
    /** Contract version of the mode:'pdg' impact result shape; bump on any breaking change to the PDG result fields. */
    pdgResultVersion: 2;
    error: string;
    target: PdgImpactTarget;
    direction: 'upstream' | 'downstream';
    impactedCount: 0;
    risk: 'UNKNOWN';
    suggestion?: string;
    recoverySuggestion?: string;
}
export type PdgImpactResult = PdgImpactSuccessResult | PdgImpactEmptyResult | PdgImpactDegradedResult | PdgImpactErrorResult;
export declare function makePdgImpactErrorResult(input: {
    error: string;
    target: PdgImpactTarget;
    direction: 'upstream' | 'downstream';
    mode?: 'pdg';
    suggestion?: string;
    recoverySuggestion?: string;
}): PdgImpactErrorResult;
export declare function isPdgDegradedLayerStatus(layer: PdgLayerStatus): layer is PdgDegradedLayerStatus;
export declare function makePdgLayerDegradedResult(input: {
    mode: 'pdg';
    target: PdgImpactTarget;
    direction: 'upstream' | 'downstream';
    layer: PdgDegradedLayerStatus;
}): PdgImpactDegradedResult;
/** The two impact engines (KTD1). `'callgraph'` is the default/established path. */
export type ImpactMode = 'callgraph' | 'pdg';
/**
 * Validate the `impact` `mode` param (KTD5 — backend hard-gate).
 *
 * The MCP JSON-schema `enum` is advisory only (server.ts forwards args
 * unvalidated and `callTool` is reachable directly), so this backend check is
 * the real boundary — mirroring `_pdgQueryImpl`'s `mode` enum validation. A
 * typo'd mode silently running callgraph is exactly the silent fallback this
 * forbids (it would make the accuracy harness compare callgraph-vs-callgraph
 * and report perfect parity).
 *
 * Absent / `undefined` / `'callgraph'` all resolve to `'callgraph'` (the
 * unchanged default path). `'pdg'` is valid. Anything else — `'PDG'`, `'pgd'`,
 * `''`, or a non-string (`0`, `null`, …) — returns a structured `{ error }`,
 * never a callgraph result.
 */
export declare function validateImpactMode(rawMode: unknown): {
    mode: ImpactMode;
} | {
    error: string;
};
/** The two independently-stamped PDG sub-layers (KTD7). */
export type PdgSubLayer = 'CDG' | 'REACHING_DEF';
/**
 * Four-state PDG-layer presence/degradation status (KTD7).
 *
 * - `'no-layer'`         — `meta.pdg` is absent: this repo was never analyzed
 *                          with `--pdg` (definitive; established with NO DB scan).
 * - `'sub-layer-missing'`— exactly one of the two independently-stamped caps
 *                          (`maxCdgEdgesPerFunction` / `maxReachingDefEdgesPerFunction`)
 *                          is present. `impact`'s PDG mode needs BOTH, so a
 *                          partial layer must not be reported as complete; the
 *                          missing one is named in `missingSubLayer`.
 * - `'ready'`            — both caps present: the layer is fully stamped.
 * - `'unknown'`          — meta is unreadable (e.g. a seeded test DB with no
 *                          `meta.json`). One bounded `LIMIT 1` probe distinguishes
 *                          a genuinely edge-free index from a missing one; either
 *                          way the conclusion is inconclusive (a missing layer is
 *                          indistinguishable from an all-linear one — #2188).
 */
export interface PdgLayerStatus {
    state: 'no-layer' | 'sub-layer-missing' | 'ready' | 'unknown';
    /** Set only for `'sub-layer-missing'` — the cap that was NOT stamped. */
    missingSubLayer?: PdgSubLayer;
    /** Human-readable guidance for the degraded states (absent for `'ready'`). */
    note?: string;
    /** Set when an unknown-state probe failed before it could inspect PDG rows. */
    probeError?: string;
    /** Optional operator-facing recovery hint for probe failures. */
    recoverySuggestion?: string;
    /**
     * FU-C return-value-ascent layer presence (read from `meta.pdg.hasCallSummary`).
     * `true` ⇒ CALL_SUMMARY edges exist, so return-value ascent is active. `false`
     * ⇒ a PRE-FU-C (v3) `--pdg` index — the intra slice is unaffected, but the
     * result should NOTE "no return-value ascent (re-index for CALL_SUMMARY)".
     * Meaningful only for the meta-readable states (`'ready'` / `'sub-layer-missing'`
     * / `'no-layer'`); `undefined` for `'unknown'` (meta unreadable). Deliberately
     * NOT part of the `'ready'` gate — a v3 index is still `'ready'` for the slice.
     */
    hasCallSummary?: boolean;
}
/**
 * Project the both-caps PDG meta read down to the single mode-relevant cap that
 * `_pdgQueryImpl` keys on (`controls` → CDG, `flows` → REACHING_DEF), preserving
 * its established tri-state `boolean | undefined` contract byte-for-byte
 * (Feasibility Issue 4):
 *   - `false`     — meta readable and the relevant cap absent → definitive
 *                   no-layer (short-circuits before any DB scan).
 *   - `true`      — meta readable and the relevant cap present → proceed.
 *   - `undefined` — meta unreadable → defer to the post-anchored-query probe.
 *
 * `_pdgQueryImpl` needs only ONE cap, so it collapses the both-caps read here
 * rather than consuming `pdgLayerStatus` directly (whose `'unknown'` state does
 * an upfront global probe — wrong timing/order for the anchored-query path).
 */
export declare function pdgStampForMode(lbugPath: string, mode: 'controls' | 'flows', loadMetaFn?: typeof loadMeta): Promise<boolean | undefined>;
/**
 * PDG-layer presence/degradation check for the `impact` PDG mode (KTD7).
 *
 * Returns the four distinct states WITHOUT scanning the DB except for the single
 * bounded `LIMIT 1` probe the `'unknown'` (meta-unreadable) case requires. The
 * caller (`_impactImpl` PDG branch, and the accuracy harness) surfaces a
 * distinct signal per state so a missing `--pdg` layer / partial layer is never
 * silently misread as a confident empty blast radius. Impact needs BOTH the CDG
 * and the REACHING_DEF sub-layer, so a partial stamp degrades, not proceeds.
 */
export declare function pdgLayerStatus(deps: {
    lbugPath: string;
    executeParameterized: typeof executeParameterized;
    loadMetaFn?: typeof loadMeta;
}): Promise<PdgLayerStatus>;
export interface RunPdgImpactDeps {
    repo: {
        lbugPath: string;
    };
    sym: {
        id: string;
        name: string;
        filePath: string;
        startLine?: number;
        endLine?: number;
    };
    symType: string;
    direction: 'upstream' | 'downstream';
    maxDepth: number;
    limit: number;
    /** Statement anchor (1-based source line). */
    line?: number;
    executeParameterized: typeof executeParameterized;
    /**
     * Whether this index carries the FU-C `CALL_SUMMARY` return-value-ascent layer
     * (from `meta.pdg.hasCallSummary`, read by the caller's `pdgLayerStatus`).
     * `false`/`undefined` ⇒ a PRE-FU-C (v3) `--pdg` index: the intra slice is
     * served unchanged, but the result `note` flags "no return-value ascent
     * (re-index for CALL_SUMMARY)". Defaults to a sound `false` (no false ascent
     * claim) when the caller omits it.
     */
    callSummaryAvailable?: boolean;
}
export declare function runImpactPDG(deps: RunPdgImpactDeps): Promise<PdgImpactResult>;
type PdgBridgeEvidence = Extract<PdgImpactEvidence, 'callgraph-bridge' | 'unproven-bridge'>;
export interface PdgBridgeEvidenceInfo {
    evidence: PdgBridgeEvidence;
    basis: string;
}
export interface PdgBridgeOptions {
    /**
     * Leaf callee names invoked in the criterion's dependence-slice blocks
     * (`BasicBlock.callees`). A first-hop callee is "proven" statement-precise iff
     * its name is in this set — i.e. it is actually called from a statement the
     * changed line reaches, not merely somewhere in the whole function. Empty/absent
     * ⇒ no statement slice to discriminate (upstream or whole-symbol) ⇒ the symbol
     * graph is used as a compatibility bridge (all callgraph-bridge), preserving
     * callgraph reach.
     *
     * REQUIRED (co-populated with {@link sliceCalleeIds}): `local-backend` builds
     * the bridge by reading BOTH cells from the same slice blocks, so a missing
     * key is an EMPTY set, never `undefined`. Keeping both non-optional is what
     * lets the capped-block sentinel guard below read `sliceCalleeNames` directly
     * (the cap is name-agnostic — a capped block always carries the sentinel here).
     */
    sliceCalleeNames: ReadonlySet<string>;
    /**
     * Resolved callee symbol ids invoked in the criterion's dependence-slice blocks
     * (`BasicBlock.calleeIds`). This is the SOUND primary key: a first-hop callee is
     * "proven" statement-precise iff its resolved symbol id is in this set, which
     * eliminates same-leaf-name collision (false-positive) and import-alias/rename
     * (false-negative) — failure modes the name set cannot distinguish. Empty/absent
     * ⇒ no captured ids (pre-v3 index / upstream / whole-symbol) ⇒ fall back to the
     * leaf-name match (`sliceCalleeNames`). REQUIRED (co-populated with
     * {@link sliceCalleeNames}) — an empty set means "no ids", never `undefined`.
     */
    sliceCalleeIds: ReadonlySet<string>;
}
export declare function pdgBridgeEvidenceForImpact(input: {
    bridge: PdgBridgeOptions;
    depth: number;
    calleeName: unknown;
    calleeId?: unknown;
    inherited?: PdgBridgeEvidenceInfo;
}): PdgBridgeEvidenceInfo;
/**
 * Pick the stronger of two bridge-evidence verdicts for the same reached symbol.
 * `callgraph-bridge` (proven) beats `unproven-bridge`, so a node reachable from
 * multiple parents is proven if ANY parent proves it. This makes the
 * proven/unproven label order-independent of DB row iteration — a diamond-reached
 * symbol gets the same label regardless of which parent the BFS visits first
 * (PR #2227 tri-review, P3).
 */
export declare function betterBridgeEvidence(existing: PdgBridgeEvidenceInfo | undefined, candidate: PdgBridgeEvidenceInfo): PdgBridgeEvidenceInfo;
/**
 * Compose `mode:'pdg'` into one user-facing impact result:
 *
 * - `affectedStatements` / `reachableBlocks` stay owned by the persisted PDG
 *   layer (CDG + REACHING_DEF), preserving the statement-level intra result.
 * - `interproceduralByDepth` / `pdgInterprocedural` expose the symbol reach;
 *   `byDepth` stays as the compatibility symbol bucket so existing consumers
 *   still see one PDG result shape.
 *
 * The callgraph option remains available as the comparator/default path; this
 * helper only changes the `pdg` result contract from intra-only to unified.
 */
export declare function composeUnifiedPdgImpactResult(pdgResult: PdgImpactResult, interproceduralResult: any | null, interproceduralError?: unknown): PdgImpactResult;
export {};
