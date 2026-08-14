/**
 * Phase: processes
 *
 * Detects execution flows (processes) and creates Process nodes +
 * STEP_IN_PROCESS edges. Also links Route/Tool nodes to processes.
 *
 * @deps    communities, routes, tools, pruneLocalSymbols, structure, parse
 * @reads   graph (all nodes and relationships), communityResult, routeRegistry,
 *          toolDefs, parse's allFetchCalls + allORMQueries (R3-6 sink sites)
 * @writes  graph (Process nodes, STEP_IN_PROCESS edges, ENTRY_POINT_OF edges)
 */
import type { PipelinePhase } from './types.js';
import { type ProcessDetectionResult } from '../process-processor.js';
export interface ProcessesOutput {
    processResult: ProcessDetectionResult;
}
/**
 * Compute the dynamic max-processes budget from the symbol count.
 *
 * Scales proportionally (symbolCount / 10) with a floor of 20.
 * Prior to #2198 this was capped at 300 via `Math.min(300, …)`,
 * silently truncating process detection on large repositories.
 */
export declare function computeDynamicMaxProcesses(symbolCount: number): number;
export declare const processesPhase: PipelinePhase<ProcessesOutput>;
