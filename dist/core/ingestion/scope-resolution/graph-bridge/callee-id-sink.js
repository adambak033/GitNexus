/**
 * Resolved-callee-id capture sink (#2227 follow-up plan U2).
 *
 * During Phase-4 scope-resolution CALLS-edge emission, each resolved call
 * site's `(callSiteLine, callSiteCol) → resolvedCalleeId` mapping is
 * accumulated here — across ALL THREE CALLS emit paths
 * (`emitReceiverBoundCalls` via `tryEmitEdge`/`tryEmitEdgeWithExplicitTargetId`,
 * and the inline `graph.addRelationship` in `emitFreeCallFallback` and
 * `emitReferencesViaLookup`), each BEFORE its dedup (KTD6/R8). A later unit
 * (U3) joins this map to CFG `BasicBlock`s by exact call-site position and
 * emits a `BasicBlock.calleeIds` set.
 *
 * KEY ALIGNMENT (plan KTD7 — load-bearing): the key is the call/new
 * expression node's start position — `line` 1-based (`startPosition.row + 1`),
 * `col` 0-based (`startPosition.column`). This MUST equal the U1
 * `SiteRecord.at` so the U3 position join lands. The CALLS resolution exposes
 * the same node's range via `site.atRange` (`atRange: anchor.range`,
 * scope-extractor.ts:1030), whose `startLine`/`startCol` are built by
 * `nodeToCapture` as `row + 1` / `column` (1-based line, 0-based col — see the
 * `Range` doc in gitnexus-shared). So a capture keyed on
 * `(atRange.startLine, atRange.startCol)` is byte-equal to U1's `at` — no
 * normalization needed.
 *
 * Gating (R4): the concrete sink is created in `run.ts` when PDG is enabled OR
 * always-on callable-flow facts need direct call targets for actual→formal
 * propagation. The read-side CFG join remains strictly PDG-gated.
 *
 * Multi-target dispatch (R2/KTD8): one site → multiple emit calls → the `Set`
 * accumulates every resolved target. Capture is per-emit-call, so the
 * candidate set is complete and a real target is never dropped.
 */
/** Build the position key from a call-site anchor. Single source of truth so
 *  producer (this sink) and consumer (U3's CFG join) encode positions
 *  identically. */
export function calleeIdPosKey(line, col) {
    return `${line}:${col}`;
}
/**
 * Create the concrete nested-`Map` accumulator for PDG callee capture or
 * callable-value-flow's direct-target index.
 */
export function createCalleeIdAccumulator(shouldCapture) {
    const byFile = new Map();
    return {
        add(filePath, line, col, calleeId) {
            if (shouldCapture?.(filePath, line, col) === false)
                return;
            let byPos = byFile.get(filePath);
            if (byPos === undefined) {
                byPos = new Map();
                byFile.set(filePath, byPos);
            }
            const key = calleeIdPosKey(line, col);
            let ids = byPos.get(key);
            if (ids === undefined) {
                ids = new Set();
                byPos.set(key, ids);
            }
            ids.add(calleeId);
        },
        get(filePath) {
            return byFile.get(filePath);
        },
        delete(filePath) {
            byFile.delete(filePath);
        },
    };
}
