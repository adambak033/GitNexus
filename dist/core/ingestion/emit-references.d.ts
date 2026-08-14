/**
 * Phase 5 of the RFC #909 ingestion lifecycle: drain `ReferenceIndex`
 * into the knowledge graph as labeled edges with `confidence` and
 * `evidence` properties (Ring 2 PKG #925).
 *
 * The resolution phase (future PR) writes `Reference` records into
 * `model.scopes.referenceSites`-derived `ReferenceIndex`; this module
 * materializes those records as `GraphRelationship`s via
 * `graph.addRelationship`. Every emitted edge carries:
 *
 *   - `type`: one of `'CALLS' | 'ACCESSES' | 'INHERITS' | 'USES'`
 *     (mapped from `Reference.kind` — `'read'` and `'write'` both route
 *     to `ACCESSES`; `'type-reference'` and `'import-use'` route to
 *     `USES`; `'call'` stays `CALLS`; `'inherits'` stays `INHERITS`).
 *   - `confidence`: the pre-computed confidence from the Reference record.
 *   - `reason`: human-readable summary (`"scope-resolution: call | confidence 0.75"`).
 *   - `evidence`: the full `ResolutionEvidence[]` trace — additive graph
 *     property (see `GraphRelationship.evidence` in gitnexus-shared),
 *     so queries that don't know about it are unaffected.
 *   - `step`: carries the reference's access-kind discriminant when
 *     available (`1` for read, `2` for write) so `ACCESSES` edges retain
 *     the read/write distinction without forcing a new edge type.
 *
 * ## Optional scope-tree flush
 *
 * When `INGESTION_EMIT_SCOPES=1` is set, this module also emits:
 *
 *   - `Scope` nodes for every `Scope` in the tree
 *   - `CONTAINS` edges from parent scope to child scope
 *   - `DEFINES` edges from scope to its `ownedDefs` members
 *   - `IMPORTS` edges from scope to `targetModuleScope` of each finalized
 *     `ImportEdge` that carries one
 *
 * Off by default — existing queries that don't know about `Scope` nodes
 * continue to work, and the storage cost is opt-in.
 *
 * ## Source-of-truth: the caller def for a reference
 *
 * A `Reference` says "some code inside `fromScope` references `toDef`".
 * The graph wants `(callerNodeId, calleeNodeId)`. We resolve the caller
 * by walking up the scope tree from `fromScope` until we find a scope
 * whose `ownedDefs` contains a Function-like def. If no such ancestor
 * exists, the edge is attributed to the first def owned by the innermost
 * ancestor scope, and if THAT produces nothing either the edge is
 * skipped (with a count returned in `EmitStats.skippedNoCaller`).
 */
import type { ReferenceIndex } from '../../_shared/index.js';
import type { KnowledgeGraph } from '../graph/types.js';
import type { ScopeResolutionIndexes } from './model/scope-resolution-indexes.js';
export interface EmitStats {
    readonly edgesEmitted: number;
    /** References dropped because no caller def could be resolved. */
    readonly skippedNoCaller: number;
    /** References dropped because `toDef` was not found in the DefIndex. */
    readonly skippedMissingTarget: number;
    /** Scope nodes emitted — `0` unless `INGESTION_EMIT_SCOPES=1`. */
    readonly scopeNodesEmitted: number;
    /** Scope-tree structural edges emitted — `0` unless `INGESTION_EMIT_SCOPES=1`. */
    readonly scopeEdgesEmitted: number;
}
export interface EmitReferencesInput {
    readonly graph: KnowledgeGraph;
    readonly scopes: ScopeResolutionIndexes;
    readonly referenceIndex: ReferenceIndex;
    /** Human-consumable label for the `reason` prefix. Defaults to `'scope-resolution'`. */
    readonly sourceLabel?: string;
}
/**
 * Drain `referenceIndex.bySourceScope` into graph edges.
 *
 * The scope-tree flush is controlled separately by
 * `INGESTION_EMIT_SCOPES` — callers can run `emitReferencesToGraph`
 * without scope-node emission or layer the two calls as needed.
 */
export declare function emitReferencesToGraph(input: EmitReferencesInput): EmitStats;
/**
 * Emit `Scope` nodes + `CONTAINS`/`DEFINES`/`IMPORTS` edges representing
 * the lexical scope tree itself. Skipped unless `INGESTION_EMIT_SCOPES=1`
 * at the public entry point; exported here for tests that want to
 * exercise the path directly.
 */
export declare function emitScopeGraph(input: {
    readonly graph: KnowledgeGraph;
    readonly scopes: ScopeResolutionIndexes;
}): {
    readonly scopeNodesEmitted: number;
    readonly scopeEdgesEmitted: number;
};
