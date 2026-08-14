/**
 * Phase: structure
 *
 * Builds File and Folder nodes in the graph from scanned paths.
 *
 * @deps    scan
 * @reads   allPaths (from scan phase)
 * @writes  graph (File, Folder nodes + CONTAINS edges)
 */
import type { PipelinePhase } from './types.js';
/** Structure phase produces no additional data — it writes directly to the graph. */
export interface StructureOutput {
    /** Pass-through from scan for downstream phases. */
    scannedFiles: {
        path: string;
        size: number;
    }[];
    allPaths: string[];
    /**
     * Materialized once here and shared across all downstream consumers
     * (cobol, markdown, cross-file propagation). Avoids the previous
     * per-phase `new Set(allPaths)` allocations on multi-thousand-file repos.
     */
    allPathSet: ReadonlySet<string>;
    totalFiles: number;
}
export declare const structurePhase: PipelinePhase<StructureOutput>;
