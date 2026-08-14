/**
 * Phase: markdown
 *
 * Processes Markdown/MDX files to extract headings and cross-links.
 *
 * @deps    structure
 * @reads   scannedFiles, allPaths (from structure phase)
 * @writes  graph (Markdown section nodes + cross-link edges)
 */
import type { PipelinePhase } from './types.js';
export interface MarkdownOutput {
    /** Number of markdown sections extracted. */
    sections: number;
    /** Number of cross-links created. */
    links: number;
}
export declare const markdownPhase: PipelinePhase<MarkdownOutput>;
