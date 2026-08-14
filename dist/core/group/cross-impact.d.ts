/**
 * Cross-repo impact (Phase 1 local walk + Phase 2 bridge fan-out).
 * All bridge Cypher for this feature lives in this module.
 */
import type { BridgeHandle, CrossRepoImpact, GroupImpactResult } from './types.js';
import type { GroupToolPort } from './service.js';
import { compareCodeUnits } from '../../lib/utils.js';
/** Cross-boundary hops beyond this value are clamped (multi-hop reserved for future work). */
export declare const MAX_SUPPORTED_CROSS_DEPTH = 1;
/** Default wall-clock budget for the Phase 1 `impact` leg when callers omit `timeoutMs`. */
export declare const DEFAULT_LOCAL_IMPACT_TIMEOUT_MS = 30000;
/**
 * Cap on neighbour fan-outs attempted per group-impact request.
 *
 * The bound used to be the wall clock alone, which made the cutoff a function
 * of machine load: an idle host traversed more crossings and `mergeRisk`
 * escalated to CRITICAL at three, while a loaded host stopped at two and
 * reported HIGH or lower — same graph, same arguments, different verdict
 * (#2787). A count is deterministic, and the neighbour list carries a total
 * order over the full crossing identity (confidence DESC, then repo, uid,
 * contract), so the cap keeps the strongest crossings rather than an arbitrary
 * prefix.
 *
 * 50 is borrowed from `MAX_CROSSINGS_TO_TRY` (cross-trace.ts) on cost, not on
 * scope — that one caps ContractLinks per repo pair inside a trace, this one
 * caps the total across all neighbour repos in one impact call, and group impact
 * had no numeric cap at all before #2787. The wall clock stays as a hang
 * backstop below; this is the bound that normally binds.
 */
export declare const MAX_NEIGHBOR_FANOUT = 50;
export type BridgeNeighborRow = {
    neighborRepo: string;
    neighborUid: string;
    neighborFilePath?: string;
    matchType: string;
    confidence: number;
    contractId: string;
    contractType: string;
};
export interface RunGroupImpactDeps {
    port: GroupToolPort;
    gitnexusDir: string;
}
/**
 * Clamp the impact timeout to a sane bounded range. Callers can feed this
 * via tool params, so an unclamped value lets a single request hold a
 * timer slot for an arbitrarily long duration (CodeQL js/resource-
 * exhaustion). 100ms lower bound preserves test-suite scenarios that
 * exercise tight timeouts; 5min upper bound is well above any legitimate
 * single-impact compute. Applied at the validate boundary so the
 * downstream `deadline` (Date.now() + timeoutMs) and the local-leg
 * `setTimeout` see the same clamped value — earlier shapes had a 1hr
 * outer cap and a 5min inner clamp that disagreed.
 */
export declare const IMPACT_TIMEOUT_MIN_MS = 100;
export declare const IMPACT_TIMEOUT_MAX_MS: number;
export declare function clampTimeout(timeoutMs: number): number;
export declare function validateGroupImpactParams(params: Record<string, unknown>): {
    ok: true;
    name: string;
    repoPath: string;
    target: string;
    direction: 'upstream' | 'downstream';
    maxDepth: number;
    crossDepth: number;
    crossDepthWarning?: string;
    relationTypes?: string[];
    includeTests: boolean;
    minConfidence: number;
    service?: string;
    subgroup?: string;
    timeoutMs: number;
} | {
    ok: false;
    error: string;
};
/**
 * Race a single Phase-2 `impactByUid` call against a remaining-budget
 * timer. The Codex adversarial review on PR #1331 surfaced that the
 * fanout loop only checked `Date.now() > deadline` *between* neighbor
 * calls — once `await port.impactByUid(...)` was reached, a hung
 * neighbor could pin the request indefinitely, and slow neighbors
 * could compound past the 5-min `IMPACT_TIMEOUT_MAX_MS` cap.
 *
 * This helper wraps each call: a `setTimeout(remainingMs)` aborts an
 * `AbortController` whose signal is forwarded to `impactByUid`, and a
 * `Promise.race` resolves to `{ timedOut: true }` when the timer
 * fires before the call completes. Implementors that ignore the
 * signal (current local backend) still see their await resolved by
 * the race; full cooperative cancellation inside the BFS is a future
 * follow-up. On rejection, the value is `null` (matching the
 * fanout's existing `if (fan == null)` truncation contract).
 *
 * Exported for direct unit testing — the helper IS the load-bearing
 * mitigation surface, so the U3 regression test pins it directly
 * rather than driving the full `runGroupImpact` path.
 */
export declare function safeNeighborImpact(port: GroupToolPort, repoId: string, uid: string, direction: string, opts: {
    maxDepth: number;
    relationTypes: string[];
    minConfidence: number;
    includeTests: boolean;
}, remainingMs: number): Promise<{
    value: unknown;
    timedOut: boolean;
}>;
export declare function collectImpactSymbolUids(local: unknown, servicePrefix: string | undefined): {
    uids: string[];
    targetFilePath?: string;
};
export declare function mergeRisk(localRisk: string, cross: CrossRepoImpact[]): string;
export declare function ensureBridgeReady(groupDir: string): Promise<{
    handle: BridgeHandle;
} | {
    error: string;
}>;
/**
 * Resolve cross-repo neighbors over `ContractLink` for a set of local symbol
 * UIDs, in a single direction, sorted by descending confidence.
 *
 * This is the one shared consumer↔provider bridge join. `runGroupImpact`'s
 * Phase-2 fan-out uses it directly; the cross-repo trace path (`cross-trace.ts`)
 * reuses the same `queryBridge` + row-normalization primitives but issues a
 * distinct *pair* query, because a trace must keep BOTH endpoints of a crossing
 * (this neighbor join intentionally returns only the far side, which is lossy
 * for stitching a path). Keeping this helper as the single uid-filtered join
 * means impact never forks its own copy of the neighbor Cypher.
 *
 * Returns `[]` for an empty `uids` set without touching the DB.
 */
export declare function resolveBridgeNeighbors(handle: BridgeHandle, opts: {
    localRepo: string;
    uids: string[];
    direction: 'upstream' | 'downstream';
}): Promise<BridgeNeighborRow[]>;
export declare function runGroupImpact(deps: RunGroupImpactDeps, params: Record<string, unknown>): Promise<GroupImpactResult | {
    error: string;
}>;
export { normalizeServicePrefix, fileMatchesServicePrefix } from './group-path-utils.js';
export { compareCodeUnits };
