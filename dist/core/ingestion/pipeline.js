/**
 * Pipeline orchestrator — dependency-ordered ingestion pipeline.
 *
 * The pipeline is composed of named phases with explicit dependencies.
 * Each phase is defined in its own file under `pipeline-phases/`.
 * The runner in `pipeline-phases/runner.ts` executes phases in
 * topological order, passing typed outputs from upstream phases as
 * inputs to downstream phases.
 *
 * To add a new phase:
 * 1. Create a new file in `pipeline-phases/` following the pattern
 * 2. Export it from `pipeline-phases/index.ts`
 * 3. Add it to the `ALL_PHASES` array below
 *
 * See ARCHITECTURE.md for the full phase dependency diagram.
 */
import { createKnowledgeGraph } from '../graph/graph.js';
import { GraphEmitSink } from '../lbug/graph-emit-sink.js';
import { runPipeline, getPhaseOutput, scanPhase, structurePhase, markdownPhase, cobolPhase, parsePhase, routesPhase, toolsPhase, ormPhase, crossFilePhase, scopeResolutionPhase, springConfigPhase, springAutoConfigurationPhase, springAopPhase, springAopInheritancePhase, pruneLocalSymbolsPhase, taintSummariesPhase, callSummariesPhase, mroPhase, diPhase, communitiesPhase, processesPhase, PhaseRegistry, } from './pipeline-phases/index.js';
// ── Phase registry ─────────────────────────────────────────────────────────
/**
 * All pipeline phases with their dependency relationships.
 *
 * Phase dependency graph:
 *
 *   scan → structure → [springConfig, markdown, cobol] → parse → [routes, tools, orm]
 *     → crossFile → scopeResolution → [springAutoConfiguration, springAop] → pruneLocalSymbols
 *     → mro → springAopInheritance → di → communities → processes
 *
 * To add a new phase: create a file in pipeline-phases/, export the phase
 * object, and `.register()` it at the appropriate position below. Opt-in
 * phases pass an `enabledWhen` predicate (issue #2080 phase-registry seam) —
 * the legacy `if (!skipGraphPhases)` guard is now expressed that way on the
 * three graph phases, with no change in behaviour.
 *
 * Exported for the parity test (`pipeline-phase-registry.test.ts`), which
 * asserts the produced list is byte-identical to the legacy array for every
 * options combination.
 */
export function buildPhaseList(options) {
    return (new PhaseRegistry()
        .register(scanPhase)
        .register(structurePhase)
        .register(springConfigPhase)
        .register(markdownPhase)
        .register(cobolPhase)
        .register(parsePhase)
        .register(routesPhase)
        .register(toolsPhase)
        .register(ormPhase)
        .register(crossFilePhase)
        .register(scopeResolutionPhase)
        .register(springAutoConfigurationPhase)
        .register(springAopPhase)
        .register(pruneLocalSymbolsPhase)
        // M4 (#2084): interprocedural taint fixpoint — the first real opt-in
        // pdg-gated phase. Off ⇒ absent ⇒ byte-identical graph. No always-on
        // phase depends on it (a filtered-out dep would throw in getPhaseOutput).
        .register(taintSummariesPhase, { enabledWhen: (o) => o.pdg === true })
        .register(callSummariesPhase, { enabledWhen: (o) => o.pdg === true })
        .register(mroPhase, { enabledWhen: (o) => !o.skipGraphPhases })
        .register(springAopInheritancePhase, { enabledWhen: (o) => !o.skipGraphPhases })
        .register(diPhase, { enabledWhen: (o) => !o.skipGraphPhases })
        .register(communitiesPhase, { enabledWhen: (o) => !o.skipGraphPhases })
        .register(processesPhase, { enabledWhen: (o) => !o.skipGraphPhases })
        // Normalize a missing options object once here so phase predicates above
        // take a required PipelineOptions and need no `?.` guard (#2080 review S1).
        .build(options ?? {}));
}
// ── Pipeline orchestrator ─────────────────────────────────────────────────
export const runPipelineFromRepo = async (repoPath, onProgress, options) => {
    const graph = createKnowledgeGraph();
    const pipelineStart = Date.now();
    // Streamed structural emit (#2680). The sink is a write-routing façade over
    // `graph`; it streams nothing until `beginStreaming()` fires at the parse
    // boundary.
    //
    // A missing `graphEmitCsvDir` is a caller bug, not a reason to quietly skip
    // streaming: this is on by default, so a programmatic host that builds its own
    // `PipelineOptions` (eval-server, the MCP daemon, a test) would otherwise ask
    // for streaming, silently not get it, and still see a successful run. Fail
    // loudly instead — the whole point of the surrounding work is that a degraded
    // outcome must never look like a clean one.
    let graphEmitSink;
    if (options?.streamGraphEmit === true) {
        if (options.graphEmitCsvDir === undefined) {
            throw new Error('streamGraphEmit was requested but graphEmitCsvDir is missing. The caller owns ' +
                'storage-path resolution (see resolveNativeSafeStorageDir in run-analyze.ts); ' +
                'pass the directory, or leave streamGraphEmit unset to run without streaming.');
        }
        graphEmitSink = new GraphEmitSink(graph, options.graphEmitCsvDir);
    }
    const phases = buildPhaseList(options);
    let graphEmitManifest;
    let results;
    try {
        results = await runPipeline(phases, {
            repoPath,
            graph: graphEmitSink ?? graph,
            onProgress,
            options,
            pipelineStart,
            graphEmit: graphEmitSink,
        });
        graphEmitManifest = graphEmitSink?.finalize();
    }
    finally {
        // Release per-pair fds when the pipeline threw before finalize ran.
        graphEmitSink?.close();
    }
    // Extract final results for the PipelineResult contract
    const { totalFiles, usedWorkerPool } = getPhaseOutput(results, 'parse');
    let communityResult;
    let processResult;
    const scopeResolutionOutput = getPhaseOutput(results, 'scopeResolution');
    const resolutionOutcomes = scopeResolutionOutput.resolutionOutcomes;
    const undecidedSatisfaction = scopeResolutionOutput.undecidedSatisfaction;
    // Streamed PDG-emit manifest (#2202): present only when streaming was on.
    const pdgEmitManifest = scopeResolutionOutput.pdgEmitManifest;
    const propertyInference = scopeResolutionOutput.propertyInference;
    // Presence check, not `!skipGraphPhases`: phases can now be filtered out by
    // any `enabledWhen` predicate (streamGraphEmit disables communities/processes
    // too), and `getPhaseOutput` THROWS on a phase that was never resolved. Keying
    // off the options flag alone made every filtered-out combination crash here
    // rather than return undefined results.
    if (results.has('communities') && results.has('processes')) {
        communityResult = getPhaseOutput(results, 'communities').communityResult;
        processResult = getPhaseOutput(results, 'processes').processResult;
    }
    onProgress({
        phase: 'complete',
        percent: 100,
        message: communityResult && processResult
            ? `Graph complete! ${communityResult.stats.totalCommunities} communities, ${processResult.stats.totalProcesses} processes detected.`
            : 'Graph complete! (graph phases skipped)',
        stats: {
            filesProcessed: totalFiles,
            totalFiles,
            nodesCreated: graph.nodeCount,
        },
    });
    return {
        // The RAW graph, deliberately — NOT `graphEmitSink`. Phases above received
        // the sink so their reads are complete, but `loadGraphToLbug` feeds this to
        // `streamAllCSVsToDisk`, and the sink's complete iterator would then emit
        // every streamed edge a SECOND time on top of the per-pair CSVs the sink
        // already wrote and the manifest already COPYs. Returning the sink here
        // silently doubles every streamed relationship in the persisted graph.
        graph,
        repoPath,
        totalFileCount: totalFiles,
        graphEmitManifest,
        communityResult,
        processResult,
        resolutionOutcomes,
        undecidedSatisfaction,
        usedWorkerPool,
        pdgEmitManifest,
        propertyInference,
    };
};
