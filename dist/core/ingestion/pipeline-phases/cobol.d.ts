/**
 * Phase: cobol
 *
 * Processes COBOL and JCL files via regex extraction (no tree-sitter).
 *
 * @deps    structure
 * @reads   scannedFiles, allPaths (from structure phase)
 * @writes  graph (COBOL program/paragraph/section nodes, JCL job/step nodes)
 */
import type { PipelinePhase } from './types.js';
export interface CobolOutput {
    programs: number;
    paragraphs: number;
    sections: number;
}
export declare const cobolPhase: PipelinePhase<CobolOutput>;
