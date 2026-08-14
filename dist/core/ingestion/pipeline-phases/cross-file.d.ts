/**
 * Phase: crossFile
 *
 * Accumulator disposal anchor. The legacy cross-file call re-resolution that
 * this phase used to run (`runCrossFileBindingPropagation`) was owned by the
 * call-resolution DAG and skipped every registry-primary language; RING4-1
 * (#942) deleted the DAG, so the propagation is gone and this phase now only
 * disposes the `BindingAccumulator`. It is kept as a phase (rather than folded
 * into `parse`) so disposal stays sequenced after every accumulator consumer.
 *
 * @deps    parse, routes, tools, orm (waits for all post-parse phases)
 * @reads   totalFiles, bindingAccumulator
 * @writes  nothing (disposal only)
 *
 * **Accumulator ownership / residual risk.** This phase is the sole
 * disposer of the `BindingAccumulator` produced by `parse`. The dispose
 * call lives inside a `finally` block in `execute()` so that a throw
 * anywhere in the body still releases the accumulator's heap. The dependency declaration
 * (`deps: ['parse', 'routes', 'tools', 'orm']`) plus the runner's
 * topological scheduling guarantee that every other consumer of the
 * accumulator has finished before this phase starts, so disposing here
 * is correct.
 *
 * The residual risk is intentional and accepted: if a future phase is
 * inserted between `parse` and `crossFile` that reads the accumulator
 * and throws, `crossFile.execute()` never runs and the accumulator
 * leaks. Any author inserting a new phase between `parse` and
 * `crossFile` MUST either route the new phase's output through
 * `crossFile` (so disposal still happens here) or take ownership of
 * the accumulator's lifetime explicitly (its own try/finally that
 * disposes on the failure path). Do not silently rely on the GC.
 */
import type { PipelinePhase } from './types.js';
export interface CrossFileOutput {
    /** Number of files re-processed during cross-file propagation. */
    filesReprocessed: number;
}
export declare const crossFilePhase: PipelinePhase<CrossFileOutput>;
