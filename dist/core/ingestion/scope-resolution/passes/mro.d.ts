/**
 * Generic MRO (method-resolution-order) builder.
 *
 * Walks the graph's `EXTENDS` edges to recover an inheritance map,
 * then asks the per-language `LinearizeStrategy` to order each class's
 * ancestors. Returns `Map<classDefId, ancestorDefId[]>` ready to plug
 * into `MethodDispatchIndex` via `buildPopulatedMethodDispatch`.
 *
 * **Why a strategy hook:** linearization differs across languages.
 *   - Python (depth-first first-seen, single inheritance): trivially
 *     correct; multi-inheritance falls back to BFS dedup. Real C3
 *     would handle diamond hierarchies — defer until we hit one.
 *   - Java (single-inheritance only): walk one parent.
 *   - C++ (multiple inheritance): C3-like or BFS depending on how
 *     strict the consumer needs to be.
 *   - Languages without inheritance (COBOL): return empty list.
 *
 * The strategy receives the FULL ancestry context (`directParents` +
 * `parentsByDefId`) so C3 implementations have what they need.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
import type { LinearizeStrategy } from '../contract/scope-resolver.js';
/**
 * Build an MRO map keyed by scope-resolution Class `DefId`.
 *
 * Steps:
 *   1. Collect EXTENDS edges from the graph → `parentsByGraphId`.
 *   2. Collect Class defs from `parsedFiles` and translate to graph
 *      ids via `nodeLookup` → `defIdByGraphId` (the bridge between
 *      scope-resolution DefId and the legacy graph node id).
 *   3. For each Class def, ask `linearize` for its ancestor order.
 */
export declare function buildMro(graph: KnowledgeGraph, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, linearize: LinearizeStrategy): Map<string, string[]>;
/**
 * Default linearization: depth-first BFS-with-visited, first-seen
 * wins. Correct for single-inheritance languages and for Python's
 * simplified MRO. Multi-inheritance diamond hierarchies need a real
 * C3 implementation; per-language overrides land here.
 */
export declare const defaultLinearize: LinearizeStrategy;
