import { projectAnalyzeResultForIpc } from './analyze-worker-ipc.js';
// Value import (instanceof): index-lock is a lightweight storage primitive
// (node:fs/net/crypto only), so this does NOT pull in run-analyze/repo-manager.
import { IndexLockTimeoutError } from '../storage/index-lock.js';
/**
 * Run the analysis and report the outcome to the parent over IPC. Reports at most
 * one terminal message (`complete` or `error`) — and none if a cancellation
 * already claimed the terminal slot — and never throws; the caller schedules
 * `process.exit` after this resolves.
 */
export async function runWorkerAnalysis(repoPath, options, deps, runnerIdentityAtBootstrap) {
    let terminal;
    try {
        const bootstrapArgs = runnerIdentityAtBootstrap
            ? [runnerIdentityAtBootstrap]
            : [];
        const result = await deps.runFullAnalysis(repoPath, 
        // This worker force-exits right after reporting, so skip the native close
        // (it can double-free in LadybugDB's ClientContext destructor after --pdg
        // writes); flushWAL still persists the index, process.exit reclaims handles.
        { ...options, skipNativeCloseOnExit: true }, {
            onProgress: (phase, percent, message) => deps.send({ type: 'progress', phase, percent, message }),
            onLog: (message) => deps.send({ type: 'progress', phase: 'log', percent: -1, message }),
        }, ...bootstrapArgs);
        // P2 (#2264): a half-finalized repo — meta.json written but the global
        // registry entry missing (e.g. a prior collision-aborted run, or a wiped
        // registry) — must NOT be reported as a successful analysis. Mirror the CLI's
        // assertAnalysisFinalized guard so the worker surfaces it as an error instead
        // of a false `complete` that leaves the repo invisible to list_repos.
        await deps.assertAnalysisFinalized(repoPath);
        // Send a JSON-safe projection, NOT the raw result: the IPC channel is
        // default-JSON serialization and `result.pipelineResult` carries the live
        // KnowledgeGraph. See analyze-worker-ipc.ts.
        terminal = { type: 'complete', result: projectAnalyzeResultForIpc(result) };
    }
    catch (err) {
        // Report the failure to the parent over IPC (the parent surfaces the message).
        const message = err instanceof Error ? err.message : 'Analysis failed';
        // #2658 review M2: a lock-wait timeout is transient contention (another
        // analyze held the single-writer lock), not a broken build — tag it so the
        // parent can surface a retry signal instead of an opaque hard failure.
        terminal =
            err instanceof IndexLockTimeoutError
                ? { type: 'error', message, code: 'index-lock-timeout', retryable: true }
                : { type: 'error', message };
    }
    // P3 (#2264): only report if a SIGTERM cancellation hasn't already claimed the
    // terminal slot — otherwise a cancel near the finish line would report the
    // analysis as `complete` over the top of the cancellation.
    if (deps.claimTerminal())
        deps.send(terminal);
}
/**
 * Create the single-use terminal-outcome claim shared by the worker's message
 * handler and its SIGTERM handler. The first call returns `true`; every later
 * call returns `false`. This is the coordination point that prevents a cancel and
 * a completion from both reporting a terminal status (#2264 P3). Single-threaded
 * JS guarantees the check-and-set is atomic (no preemption mid-call).
 */
export function createTerminalClaim() {
    let claimed = false;
    return () => {
        if (claimed)
            return false;
        claimed = true;
        return true;
    };
}
