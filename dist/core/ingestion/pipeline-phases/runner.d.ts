/**
 * Pipeline Phase Runner
 *
 * Executes pipeline phases in dependency order using Kahn's topological sort.
 * Each phase receives typed outputs from its upstream dependencies.
 *
 * The runner is intentionally simple:
 * - No dynamic phase loading
 * - No plugin system
 * - Static phase graph, compile-time type safety
 * - Sequential execution (parallel support is architecturally possible
 *   but most phases have linear dependencies)
 */
import type { PipelinePhase, PipelineContext, PhaseResult } from './types.js';
/**
 * Execute a set of pipeline phases in dependency order.
 *
 * @param phases  All phases to execute (order doesn't matter — sorted internally)
 * @param ctx     Shared pipeline context
 * @returns       Map of phase name → PhaseResult (all completed phases)
 */
export declare function runPipeline(phases: readonly PipelinePhase[], ctx: PipelineContext): Promise<ReadonlyMap<string, PhaseResult<unknown>>>;
