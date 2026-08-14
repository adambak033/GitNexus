/**
 * Phase: scan
 *
 * Walks the repository filesystem and collects file paths + sizes.
 * Does NOT read file contents — that happens in downstream phases.
 *
 * @deps    (none — this is the pipeline root)
 * @reads   repoPath (filesystem)
 * @writes  graph (nothing yet — just returns scanned paths)
 * @output  ScannedFile[], allPaths[], totalFiles
 */
import type { PipelinePhase } from './types.js';
export interface ScanOutput {
    scannedFiles: {
        path: string;
        size: number;
    }[];
    allPaths: string[];
    totalFiles: number;
}
export declare const scanPhase: PipelinePhase<ScanOutput>;
