/**
 * Pipeline Phase — Type definitions.
 *
 * Each phase is a named node in the dependency graph with typed inputs and outputs.
 * The runner resolves dependencies via topological sort and passes
 * typed results from upstream phases as inputs to downstream phases.
 *
 * Design goals:
 *  - Explicit data flow between phases via typed outputs
 *  - The knowledge graph is a shared mutable accumulator — phases add nodes/edges
 *    and may read prior phases' contributions. This is intentional: the graph is
 *    the pipeline's primary output, not an inter-phase communication channel.
 *  - Compile-time exhaustiveness (adding a phase = type error until wired)
 *  - Each phase is independently testable with mocked inputs
 */
/**
 * Helper to extract the typed output of a dependency phase.
 *
 * Type safety note: This uses an `as T` cast because the runner stores
 * heterogeneous phase outputs in a single `Map<string, PhaseResult<unknown>>`.
 * The cast is safe as long as callers use the correct output type for the
 * named phase. Mismatches will surface as runtime type errors, not compile-time
 * errors — this is an intentional trade-off for a static phase graph without
 * a dynamic type registry.
 *
 * @param deps       The resolved dependency map from the runner
 * @param phaseName  The name of the upstream phase whose output you need
 * @returns          The typed output of the phase
 * @throws           If the phase is not found in the dependency map
 */
export function getPhaseOutput(deps, phaseName) {
    const result = deps.get(phaseName);
    if (!result) {
        throw new Error(`Phase '${phaseName}' not found in resolved dependencies`);
    }
    return result.output;
}
