import type { KnowledgeGraph } from '../graph/types.js';
export interface LocalSymbolPruneStats {
    candidateNodes: number;
    prunedNodes: number;
    keptWithSemanticEdges: number;
    skippedByEnv: boolean;
}
export declare const shouldKeepLocalValueSymbols: () => boolean;
export declare const pruneLocalValueSymbols: (graph: KnowledgeGraph, options?: {
    keepLocalValueSymbols?: boolean;
}) => LocalSymbolPruneStats;
