/**
 * Cross-repo call trace.
 *
 * Stitches per-repo directed-path segments (CALLS + HAS_METHOD, via the
 * existing single-repo `trace`) across a single `ContractLink` boundary in the
 * group bridge, and — when a `--pdg` layer is present and the caller opts in —
 * enriches the boundary-adjacent segments with their intra-procedural
 * REACHING_DEF data-flow.
 *
 * Design notes:
 *  - The crossing is a single bridge hop joined on `symbolUid` (the symbol node
 *    id is the same value the bridge stores as `Contract.symbolUid`). This
 *    mirrors `cross-impact.ts` and is clamped to one boundary
 *    (`MAX_SUPPORTED_CROSS_DEPTH`); multi-hop is deferred.
 *  - All trace-specific bridge Cypher lives in THIS module (mirroring the
 *    "all bridge Cypher for this feature lives here" convention in
 *    cross-impact.ts). The trace needs BOTH endpoints of a crossing to stitch a
 *    path, so it issues its own pair query rather than the lossy uid-filtered
 *    neighbor join exported by cross-impact (`resolveBridgeNeighbors`), which
 *    intentionally returns only the far side.
 *  - PDG is enrichment only: data flow never crosses the repo boundary. Full
 *    cross-program (SDG-like) data flow is deferred — see
 *    docs/plans/2026-06-18-002-feat-unified-pdg-impact-evaluation-plan.md.
 */
import type { GroupPdgFlowHop, GroupToolPort } from './service.js';
export interface TraceHop {
    name: string;
    filePath: string;
    startLine: number;
    /** The member repo path (group.yaml key) this hop belongs to. */
    repo: string;
}
export interface TraceEdge {
    relType: string;
    confidence: number;
}
export interface SegmentDataFlow {
    /** Member repo path of the enriched segment. */
    repo: string;
    /** The boundary-adjacent symbol the flow was anchored on. */
    anchor: string;
    variable?: string;
    hops: GroupPdgFlowHop[];
    truncated?: boolean;
}
export interface BridgeCrossing {
    fromRepo: string;
    toRepo: string;
    contractId: string;
    contractType: string;
    matchType: string;
    confidence: number;
}
export interface GroupTraceEndpoint {
    name: string;
    filePath: string;
    startLine: number;
    repo: string;
}
export interface GroupTraceOkResult {
    status: 'ok';
    group: string;
    from: GroupTraceEndpoint;
    to: GroupTraceEndpoint;
    /** 0 for a same-repo trace, 1 for a single boundary crossing. */
    crossings: BridgeCrossing[];
    hopCount: number;
    hops: TraceHop[];
    edges: TraceEdge[];
    /** Present only when PDG enrichment ran for at least one segment. */
    dataFlow?: SegmentDataFlow[];
    truncated?: boolean;
    notes: string[];
}
export interface GroupTraceCandidate {
    repo: string;
    id: string;
    name: string;
    filePath: string;
    startLine: number;
}
export interface GroupTraceNotFoundResult {
    status: 'not_found';
    group: string;
    role?: 'from' | 'to';
    query?: string;
    /**
     * True when the answer is NOT authoritative: the crossing cap
     * (`MAX_CROSSINGS_TO_TRY`) was hit, so a connecting ContractLink ranked beyond
     * the cap may have been skipped. A consumer should treat this as "unknown",
     * not "no path exists".
     */
    truncated?: boolean;
    notes: string[];
    suggestion?: string;
}
export interface GroupTraceAmbiguousResult {
    status: 'ambiguous';
    group: string;
    role: 'from' | 'to';
    candidates: GroupTraceCandidate[];
    notes: string[];
}
export interface GroupTraceErrorResult {
    status: 'error';
    group: string;
    error: string;
    notes: string[];
}
export type GroupTraceResult = GroupTraceOkResult | GroupTraceNotFoundResult | GroupTraceAmbiguousResult | GroupTraceErrorResult;
/**
 * Centralized degraded-state messages so wording stays consistent and
 * testable. Kept as named constants/builders rather than inline strings.
 */
export declare const TRACE_NOTES: {
    readonly noBridgeLink: string;
    readonly crossDepthClamped: string;
    readonly noLocalPath: (repo: string) => string;
    readonly noPdgLayer: (repo: string) => string;
    readonly pdgRequested: string;
    readonly pdgSameRepoNoop: string;
    readonly crossingsCapped: (cap: number) => string;
    readonly degradedMembers: (repos: string[]) => string;
    readonly fileBoundaryFallback: string;
    readonly anonymousHandler: (route: string, location: string) => string;
    readonly destinationNoLink: string;
    readonly destinationNoReach: string;
    readonly destinationMultiple: string;
    readonly destinationAmbiguousFile: string;
};
export interface RunGroupTraceDeps {
    port: GroupToolPort;
    gitnexusDir: string;
}
export declare function runGroupTrace(deps: RunGroupTraceDeps, params: Record<string, unknown>): Promise<GroupTraceResult>;
