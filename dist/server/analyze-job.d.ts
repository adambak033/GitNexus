/**
 * Analyze Job Manager
 *
 * Tracks server-side analysis jobs with:
 * - In-memory Map storage
 * - Single-slot concurrency (one active job at a time)
 * - Same-repo deduplication (returns existing job)
 * - Progress event emission for SSE relay
 * - 1-hour TTL cleanup for completed/failed jobs
 */
import type { ChildProcess } from 'child_process';
export interface AnalyzeJobProgress {
    phase: string;
    percent: number;
    message: string;
}
export type AnalyzeJobStatus = 'queued' | 'cloning' | 'analyzing' | 'loading' | 'complete' | 'failed';
/**
 * A job's outcome is settled — `complete` and `failed` are the only two states
 * from which nothing more is emitted (see `updateJob`'s immutability guard).
 *
 * Exported because terminality is a property of the JOB, and every consumer
 * that has to decide "is this stream over?" must ask the same question of the
 * same field. The SSE relay used to decide from the PHASE STRING of a progress
 * event instead, which let a mid-run `phase: 'complete'` close the stream
 * before the route had decided the actual outcome (#2790).
 */
export declare const isTerminalJobStatus: (status: AnalyzeJobStatus) => boolean;
/**
 * Structured detail for a job that ended `failed` while its work PARTIALLY
 * succeeded — an embedding run that persisted most nodes and dropped a few to
 * endpoint failures is not the same event as one that produced nothing.
 *
 * `AnalyzeJob.status` deliberately gains no `partial` member: the status union
 * is consumed by the web app, the CLI and every poller, and a new member would
 * be an unhandled value in each of them. This is additive and optional instead
 * — absent on every job that is not a partial embedding run, so `JSON.stringify`
 * omits it and existing payloads stay byte-identical — while giving a client
 * that wants to distinguish "retry these N nodes" from "nothing worked" enough
 * to do it (#2790 review). A UI that ignores it still sees the honest `failed`.
 */
export interface AnalyzeJobPartialOutcome {
    /** Which kind of partial result this is; only embedding runs produce one today. */
    kind: 'embedding-partial';
    /** Nodes whose rows were dropped and are checkpointed for retry. */
    pendingNodeCount: number;
    /** Nodes that completed; their rows are durable. */
    nodesProcessed: number;
}
export interface AnalyzeJob {
    id: string;
    status: AnalyzeJobStatus;
    repoUrl?: string;
    repoPath?: string;
    repoName?: string;
    progress: AnalyzeJobProgress;
    error?: string;
    /** Set only when a terminal `failed` job still persisted usable work. */
    partial?: AnalyzeJobPartialOutcome;
    startedAt: number;
    completedAt?: number;
    /** Number of times the worker has been retried after a crash. */
    retryCount: number;
}
export declare class JobManager {
    private jobs;
    private children;
    private abortControllers;
    private timeouts;
    private emitter;
    private cleanupTimer;
    constructor();
    /** Create a new job, or return existing active job for the same repo. */
    createJob(params: {
        repoUrl?: string;
        repoPath?: string;
    }): AnalyzeJob;
    getJob(id: string): AnalyzeJob | undefined;
    /** Return a snapshot of all tracked jobs for inspection. */
    listJobs(): AnalyzeJob[];
    updateJob(id: string, update: Partial<Pick<AnalyzeJob, 'status' | 'progress' | 'error' | 'partial' | 'repoPath' | 'repoName' | 'completedAt'>>): void;
    /** Register a child process for a job — enables cancellation and timeout. */
    registerChild(jobId: string, child: ChildProcess): void;
    /** Register cancellable in-process work for a job. */
    registerAbortController(jobId: string, controller: AbortController): void;
    /** Cancel a running job — sends SIGTERM to child process. */
    cancelJob(jobId: string, reason?: string): boolean;
    /** Subscribe to progress events for a job. Returns unsubscribe function. */
    onProgress(jobId: string, listener: (progress: AnalyzeJobProgress) => void): () => void;
    dispose(): void;
    private isTerminal;
    private cleanup;
}
