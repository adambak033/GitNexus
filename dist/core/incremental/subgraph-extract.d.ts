/**
 * Subgraph extraction for incremental DB writeback.
 *
 * Given the FULL ctx.graph produced by the pipeline (all files parsed,
 * all phases run) and the set of file paths whose DB rows must be
 * replaced, produce a smaller KnowledgeGraph that contains:
 *
 *   - Every node whose `properties.filePath` is in `toWriteSet`.
 *   - Every graph-wide node (Community, Process, and Spring metadata
 *     placeholders) — these are regenerated each run and must be fully
 *     rewritten.
 *   - Every relationship where AT LEAST ONE endpoint is in the writable
 *     set above. Relationships entirely between unchanged-file nodes
 *     are skipped — their rows are still in the DB and re-inserting
 *     them would PK-conflict at COPY time.
 *
 * The resulting subgraph is what gets passed to `loadGraphToLbug` after
 * the orchestrator has deleted the corresponding DB rows. Hydrated
 * unchanged-file rows are never touched in the DB.
 *
 * # Cross-file edge consistency (Finding 1)
 *
 * `extractChangedSubgraph` intentionally does NOT expand the set it is
 * given — expansion is the orchestrator's job, so the SAME expanded set
 * can be fed to both `deleteNodesForFiles` and this function (asymmetry
 * between the delete set and the write set silently corrupts the DB).
 * `computeEffectiveWriteSet` below performs the boundary-crossing 1-hop
 * walk; the orchestrator composes it with its importer-BFS expansion and
 * passes the result here.
 *
 * Why the 1-hop walk is needed: consider a barrel re-export change —
 * file C (a barrel) shifts `export { foo } from './b'` to
 * `export { foo } from './d'`. After scope resolution, file A's CALLS
 * edge to `foo` resolves to D instead of B, even though A's content is
 * byte-for-byte identical:
 *
 *   - Old A→B edge survives in DB (neither A nor B is changed → not deleted)
 *   - New A→D edge is missing (neither A nor D in writable set → skipped)
 *
 * Pulling the unchanged-side file of every writable-boundary-crossing
 * edge into the write set fixes both halves: the orchestrator's
 * `DETACH DELETE` cleans up the stale unchanged-side rows, and the new
 * cross-file edges land because at least one endpoint is now writable.
 *
 * Limitation (documented): if a file X *stopped* importing from a
 * changed file C, X has no edge to C in the new graph, so this 1-hop
 * walk doesn't catch it. The orchestrator's importer-BFS (which reads
 * IMPORTS from the pre-pipeline DB) covers that case instead.
 */
import type { KnowledgeGraph } from '../graph/types.js';
export declare const extractChangedSubgraph: (fullGraph: KnowledgeGraph, toWriteSet: ReadonlySet<string>) => KnowledgeGraph;
/**
 * Public — derive the EFFECTIVE write-set: `toWriteSet` expanded by one
 * hop along every file-owned edge in the new graph that crosses the
 * writable boundary (one endpoint in a writable file, the other in an
 * unchanged file). Graph-wide relationships are excluded: their owner
 * phase delete-alls and re-extracts them independently, so following them
 * here would turn high-fan-out metadata into a near-full-repository write.
 * For ordinary edges, the unchanged-side file is pulled in so its stale
 * rows are deleted + rewritten in lockstep with the changed side.
 *
 * Single pass over the edge list. Does NOT mutate `toWriteSet`. The
 * orchestrator MUST feed the returned set to both `deleteNodesForFiles`
 * and `extractChangedSubgraph` — feeding the unexpanded set to either
 * one leaves stale rows or PK-conflicts at COPY time.
 */
export declare const computeEffectiveWriteSet: (fullGraph: KnowledgeGraph, toWriteSet: ReadonlySet<string>) => Set<string>;
