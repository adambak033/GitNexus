/**
 * MRO primitives.
 *
 * `c3Linearize` and its BFS helper `gatherAncestors` are pure functions over a
 * `parentMap` (classId → parent ids). They carry no dependency on the semantic
 * model or graph, so the model layer stays a pure leaf — `mro-processor.ts`
 * (graph-level MRO emission) imports `c3Linearize` / `gatherAncestors` from here.
 */
/**
 * Gather all ancestor IDs in BFS / topological order.
 * Returns the linearized list of ancestor IDs (excluding the class itself).
 *
 * Uses a head-pointer BFS (`queue[head++]`) instead of `Array.shift()` to
 * avoid O(n) per-dequeue re-indexing.
 */
declare function gatherAncestors(classId: string, parentMap: Map<string, string[]>): string[];
/**
 * Compute C3 linearization for a class given a parentMap.
 * Returns an array of ancestor IDs in C3 order (excluding the class itself),
 * or null if linearization fails (inconsistent or cyclic hierarchy).
 *
 * Re-exported for mro-processor.ts (graph-level MRO emission).
 */
export declare function c3Linearize(classId: string, parentMap: Map<string, string[]>, cache: Map<string, string[] | null>, inProgress?: Set<string>): string[] | null;
export { gatherAncestors };
