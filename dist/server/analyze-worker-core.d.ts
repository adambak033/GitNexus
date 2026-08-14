/**
 * Side-effect-free core of the analyze worker's message handler.
 *
 * Extracted from `analyze-worker.ts` — a `fork()` entry module whose top-level
 * `process.on(...)` handlers and `ready` handshake make it unsafe to import in a
 * unit test. This module has no top-level side effects and takes its collaborators
 * by dependency injection, so the worker's run → finalize → report contract is
 * unit-testable without spawning a process. The entry module wires the real deps
 * and owns the `process.exit` lifecycle.
 *
 * The `import type ... typeof import(...)` forms below are erased at runtime, so
 * importing this module does NOT load `run-analyze`, `repo-manager`, or the entry
 * worker — only the lightweight `analyze-worker-ipc` projection helper.
 */
import type { AnalyzeOptions } from '../core/run-analyze.js';
import type { WorkerMessage } from './analyze-worker-protocol.js';
import type { AnalyzerRunnerIdentity } from '../storage/repo-manager.js';
export interface WorkerAnalysisDeps {
    runFullAnalysis: typeof import('../core/run-analyze.js').runFullAnalysis;
    assertAnalysisFinalized: typeof import('../storage/repo-manager.js').assertAnalysisFinalized;
    send: (msg: WorkerMessage) => void;
    /**
     * Claim the single terminal-outcome slot. Returns `true` for the first caller
     * (which may then send its `complete`/`error`) and `false` for every caller
     * after — so a SIGTERM cancellation and a near-simultaneous completion can't
     * both report a terminal outcome (#2264 P3). See {@link createTerminalClaim}.
     */
    claimTerminal: () => boolean;
}
/**
 * Run the analysis and report the outcome to the parent over IPC. Reports at most
 * one terminal message (`complete` or `error`) — and none if a cancellation
 * already claimed the terminal slot — and never throws; the caller schedules
 * `process.exit` after this resolves.
 */
export declare function runWorkerAnalysis(repoPath: string, options: AnalyzeOptions, deps: WorkerAnalysisDeps, runnerIdentityAtBootstrap?: AnalyzerRunnerIdentity): Promise<void>;
/**
 * Create the single-use terminal-outcome claim shared by the worker's message
 * handler and its SIGTERM handler. The first call returns `true`; every later
 * call returns `false`. This is the coordination point that prevents a cancel and
 * a completion from both reporting a terminal status (#2264 P3). Single-threaded
 * JS guarantees the check-and-set is atomic (no preemption mid-call).
 */
export declare function createTerminalClaim(): () => boolean;
