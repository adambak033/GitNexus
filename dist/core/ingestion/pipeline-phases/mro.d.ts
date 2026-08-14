/**
 * Phase: mro
 *
 * Computes Method Resolution Order (MRO) and creates METHOD_OVERRIDES
 * and METHOD_IMPLEMENTS edges.
 *
 * @deps    crossFile, scopeResolution, pruneLocalSymbols
 * @reads   graph (all nodes and relationships)
 * @writes  graph (METHOD_OVERRIDES, METHOD_IMPLEMENTS edges)
 */
import type { PipelinePhase } from './types.js';
export interface MROOutput {
    entries: number;
    ambiguityCount: number;
    overrideEdges: number;
    methodImplementsEdges: number;
}
export declare const mroPhase: PipelinePhase<MROOutput>;
