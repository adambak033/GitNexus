/**
 * `emitPropertyDispatchCalls` — value-ref registration edges + field-based
 * dispatch for functions registered as object-literal property values
 * (#2437).
 *
 * A provider-hook registration (`{ emitScopeCaptures: emitCppScopeCaptures }`)
 * emits a USES reference edge — a registration is not an invocation (Kythe
 * `ref` vs `ref/call`; Joern `METHOD_REF`). The invocation happens later
 * through the property (`provider.emitScopeCaptures(...)`) — a dispatch the
 * receiver-bound pass cannot resolve because object literals are not
 * IMPLEMENTS-linked implementors. This pass closes that soundness gap the
 * field-based way (Feldthaus et al., ICSE'13; CodeQL `impliedReceiverStep`):
 * key registrations by property name and connect every member-call site
 * `x.<key>(...)` to every function registered under `<key>`.
 *
 * This pass is the SINGLE owner of `value-ref` resolution. The shared
 * registries only consult pre-finalize local bindings — imported names live
 * in finalized bindings (the same reason free calls need
 * `emitFreeCallFallback`) — so `resolveReferenceSites` skips `value-ref`
 * sites and this pass resolves them post-finalize via
 * `findCallableBindingInScope` (Function/Method/Constructor only — the
 * callable gate that keeps `{ port: DEFAULT_PORT }` from emitting anything).
 *
 * Precision posture (mirrors `emitInterfaceDispatchFor`):
 *   - reason `'property-dispatch'` keeps synthesized CALLS auditable;
 *   - dispatch confidence 0.7 sits below the 0.85 resolved baseline;
 *   - a per-key fan-out cap drops promiscuous names (`handler`, `callback`)
 *     entirely rather than truncating silently — property-name collisions
 *     across unrelated objects are the documented field-based failure mode.
 *
 * Ordering: runs AFTER the precise emit passes. `graph.addRelationship` is
 * first-write-wins on the position-keyed edge id, so a site that already
 * resolved precisely to the same target keeps its precise edge.
 *
 * Language-neutral: consumes only `value-ref` sites (any language that
 * emits the capture participates) and generic member-call sites.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
import type { CalleeIdSink } from '../graph-bridge/callee-id-sink.js';
/**
 * Keys registered by more than this many distinct functions are skipped —
 * dispatch through such a name says nothing about which function runs.
 * Calibrated on this repo's own provider tables: `emitScopeCaptures` has 16
 * legitimate registrations (one per language provider), so the cap sits at
 * 2× that — dropping the motivating key was the failure the first value (8)
 * had. ponytail: flat cap; revisit with per-receiver narrowing if real
 * repos show useful keys being dropped (§12 of the #2437 plan).
 *
 * Override via `GITNEXUS_MAX_PROPERTY_DISPATCH_FANOUT` env var for repos with
 * legitimate high-fanout property keys (e.g. large Vue codebases where
 * `validator` exceeds the default).
 */
export declare const MAX_PROPERTY_DISPATCH_FANOUT: number;
/** Below the 0.85 resolved baseline; same discount idea as interface-dispatch. */
export declare const PROPERTY_DISPATCH_CONFIDENCE = 0.7;
export declare function emitPropertyDispatchCalls(graph: KnowledgeGraph, scopes: ScopeResolutionIndexes, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, calleeIdSink?: CalleeIdSink): {
    usesEmitted: number;
    callsEmitted: number;
    skippedKeys: number;
    skippedKeyNames: readonly string[];
};
