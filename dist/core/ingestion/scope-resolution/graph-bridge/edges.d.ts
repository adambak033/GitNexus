/**
 * Graph edge emission primitives.
 *
 * Two functions:
 *   - `mapReferenceKindToEdgeType` — translate a scope-resolution
 *     `Reference.kind` into the corresponding graph edge type.
 *   - `tryEmitEdge` — given a reference site + target def, resolve
 *     caller + target to graph ids and emit the edge with
 *     language-provided reason text, dedup-keyed by
 *     `(edgeType, callerId, targetId, line, col)`.
 *
 * Next-consumer contract: any language provider can call `tryEmitEdge`
 * from its own post-pass to emit edges it resolves Python-specific
 * (or TypeScript-specific, etc.) logic. The dedup key is
 * language-agnostic — no language needs to change it.
 */
import type { Reference, ScopeId, SymbolDefinition } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
import type { CalleeIdSink } from './callee-id-sink.js';
/**
 * Optional resolved-callee-id capture context (#2227 follow-up U2). Threaded
 * in under `--pdg` OR when always-on callable-flow facts need direct call
 * targets (#2437 — the accumulator then carries a position filter); else
 * `undefined` → zero overhead, byte-identity (R4).
 * `filePath` is NOT on the `site` param, so it rides here alongside the sink.
 */
export interface CalleeIdCaptureCtx {
    readonly sink: CalleeIdSink;
    readonly filePath: string;
}
/**
 * Map a `Reference.kind` to a graph edge type. `import-use` is dropped
 * (no edge type today — provenance lives on the IMPORTS edge emitted
 * by `emitImportEdges`).
 */
export declare function mapReferenceKindToEdgeType(kind: Reference['kind']): 'CALLS' | 'ACCESSES' | 'EXTENDS' | 'USES' | undefined;
/**
 * Resolve caller + target to graph ids and emit the edge. Returns true
 * if the edge was emitted (not deduped, not skipped).
 *
 * `seen` is a language-shared dedup set keyed by
 * `${edgeType}:${callerGraphId}->${targetGraphId}:${line}:${col}` so
 * multiple language-specific post-passes can share it and never
 * double-emit a resolution one of them already produced.
 */
export declare function tryEmitEdge(graph: KnowledgeGraph, scopes: ScopeResolutionIndexes, nodeLookup: GraphNodeLookup, site: {
    readonly inScope: ScopeId;
    readonly atRange: {
        startLine: number;
        startCol: number;
    };
    readonly kind: string;
    /** See {@link isPhantomCalleeRead}. Set by the extractor from the
     *  language's `@reference.callee-position` marker; absent otherwise. */
    readonly inCalleePosition?: boolean;
}, targetDef: SymbolDefinition, reason: string, seen: Set<string>, confidence?: number, collapseByCallerTarget?: boolean, calleeCapture?: CalleeIdCaptureCtx): boolean;
/**
 * Variant of `tryEmitEdge` that takes a pre-resolved target graph id
 * instead of resolving it from a `SymbolDefinition`. Used by the
 * value-receiver-owner bridge (`receiver-bound-calls.ts` Case 5) where
 * the picked owner-indexed method def carries no `qualifiedName` (object
 * literals have no class owner to seed it) and therefore cannot
 * round-trip through `resolveDefGraphId`. The def's `nodeId` IS the
 * canonical graph node id (written by the parse phase), so the caller
 * passes it directly.
 *
 * All other invariants of `tryEmitEdge` apply: dedup key shape, collapse
 * flag honoring, edge-type mapping, caller-id resolution.
 *
 * ONE deliberate exception: the {@link isPhantomCalleeRead} suppression is not
 * applied here, because it keys on the target's node label and this entry point
 * is handed an id rather than a def. Reachable only for a `read` site marked
 * `inCalleePosition` whose receiver typed as an object-literal VALUE — a
 * JS/TS-shaped registration. No language that sets the marker resolves through
 * this bridge today (verified for Go, whose func-valued struct-literal fields
 * resolve through the owned-member path instead). A language adding the marker
 * must re-check this path.
 */
export declare function tryEmitEdgeWithExplicitTargetId(graph: KnowledgeGraph, scopes: ScopeResolutionIndexes, nodeLookup: GraphNodeLookup, site: {
    readonly inScope: ScopeId;
    readonly atRange: {
        startLine: number;
        startCol: number;
    };
    readonly kind: string;
}, targetGraphId: string, reason: string, seen: Set<string>, confidence?: number, collapseByCallerTarget?: boolean, calleeCapture?: CalleeIdCaptureCtx): boolean;
