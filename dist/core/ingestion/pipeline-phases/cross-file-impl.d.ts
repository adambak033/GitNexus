/**
 * Cross-file binding propagation — extracted from pipeline.ts.
 *
 * Seeds downstream files with resolved type bindings from upstream exports.
 * Files are processed in topological import order so upstream bindings
 * are available when downstream files are re-resolved.
 *
 * @module
 */
import type { createResolutionContext } from '../model/resolution-context.js';
import { type PipelineProgress } from '../../../_shared/index.js';
import type { KnowledgeGraph } from '../../graph/types.js';
/**
 * Cross-file binding propagation.
 * Returns the number of files re-processed.
 */
export declare function runCrossFileBindingPropagation(graph: KnowledgeGraph, ctx: ReturnType<typeof createResolutionContext>, parseExportedTypeMap: ReadonlyMap<string, ReadonlyMap<string, string>>, allPathSet: ReadonlySet<string>, totalFiles: number, repoPath: string, pipelineStart: number, onProgress: (progress: PipelineProgress) => void): Promise<number>;
