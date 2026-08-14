/**
 * Flow-insensitive, inclusion-based resolution for calls through callable
 * values. Providers own syntax recognition; this pass consumes only the
 * JSON-safe facts carried by ParsedFile.
 */
import type { ParsedFile, SymbolDefinition } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
import type { CalleeIdAccumulator } from '../graph-bridge/callee-id-sink.js';
/**
 * Per-site dispatch-target cap. Above it the site is treated as overflowed and
 * its edges are dropped — a cliff, so a repo with a legitimately wide dispatch
 * table (33+ candidates on one callable site) loses the whole call chain.
 *
 * Override via `GITNEXUS_MAX_CALLABLE_VALUE_TARGETS` for such repos.
 */
export declare const MAX_CALLABLE_VALUE_TARGETS: number;
interface Target {
    readonly id: string;
    readonly def: SymbolDefinition;
}
export interface CallableValueFlowWarning {
    readonly language: string;
    readonly context: string;
    readonly candidateCount: number;
    readonly cap: number;
}
export interface CallableValueFlowResult {
    readonly emitted: number;
    readonly resolvedInvokes: number;
    readonly ambiguousInvokes: number;
    readonly unmatchedInvokes: number;
    readonly iterations: number;
}
export interface EmitCallableValueFlowInput {
    readonly graph: KnowledgeGraph;
    readonly scopes: ScopeResolutionIndexes;
    readonly parsedFiles: readonly ParsedFile[];
    readonly nodeLookup: GraphNodeLookup;
    readonly calleeIds: CalleeIdAccumulator;
    readonly language: string;
    readonly collapseByCallerTarget?: boolean;
    readonly isCallableValueTarget?: (def: SymbolDefinition) => boolean;
    readonly hasFileLocalCallableLinkage?: (def: SymbolDefinition) => boolean;
    readonly onWarn?: (warning: CallableValueFlowWarning) => void;
}
/** Position key shared with the existing free/reference skip-set contract. */
export declare function callableFlowSiteKey(filePath: string, range: {
    readonly startLine: number;
    readonly startCol: number;
}): string;
/**
 * Return only invoke sites that join to a canonical call ReferenceSite.
 * Malformed/stale facts never suppress ordinary resolution.
 */
export declare function collectDeferredIndirectSites(parsedFiles: readonly ParsedFile[], scopes?: ScopeResolutionIndexes): ReadonlySet<string>;
export declare function emitCallableValueFlow(input: EmitCallableValueFlowInput): CallableValueFlowResult;
/**
 * Pure — exported for `bench/callable-value-flow/measure.mjs`, which guards its
 * scaling ratio and result fingerprint. Not part of the pass's public contract.
 */
export declare function buildGraphTargetIndex(scopes: ScopeResolutionIndexes, nodeLookup: GraphNodeLookup, providerTarget: ((def: SymbolDefinition) => boolean) | undefined, graph: KnowledgeGraph): ReadonlyMap<string, Target>;
export {};
