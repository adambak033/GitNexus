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
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
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
export const isTerminalJobStatus = (status) => status === 'complete' || status === 'failed';
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export class JobManager {
    jobs = new Map();
    children = new Map();
    abortControllers = new Map();
    timeouts = new Map();
    emitter = new EventEmitter();
    cleanupTimer;
    constructor() {
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    }
    /** Create a new job, or return existing active job for the same repo. */
    createJob(params) {
        // Dedup: return existing active job for the same repo (by URL or path)
        for (const job of this.jobs.values()) {
            if (!this.isTerminal(job.status)) {
                const isSameRepo = (params.repoUrl && job.repoUrl === params.repoUrl) ||
                    (params.repoPath && job.repoPath === params.repoPath);
                if (isSameRepo) {
                    return job;
                }
            }
        }
        // Single-slot: reject if another job is active (different repo)
        for (const job of this.jobs.values()) {
            if (!this.isTerminal(job.status)) {
                throw new Error(`Analysis already in progress (job ${job.id})`);
            }
        }
        const job = {
            id: randomUUID(),
            status: 'queued',
            repoUrl: params.repoUrl,
            repoPath: params.repoPath,
            progress: { phase: 'queued', percent: 0, message: 'Waiting to start...' },
            startedAt: Date.now(),
            retryCount: 0,
        };
        this.jobs.set(job.id, job);
        return job;
    }
    getJob(id) {
        return this.jobs.get(id);
    }
    /** Return a snapshot of all tracked jobs for inspection. */
    listJobs() {
        return Array.from(this.jobs.values());
    }
    updateJob(id, update) {
        const job = this.jobs.get(id);
        if (!job)
            return;
        // Once a job is terminal (complete/failed) its outcome is immutable — drop any
        // later update so a worker `complete` racing a SIGTERM-driven `error` (or vice
        // versa) can't flip a reported result (#2264 P3). The transition INTO a terminal
        // state still applies because `job.status` is not yet terminal at that point.
        if (this.isTerminal(job.status))
            return;
        Object.assign(job, update);
        if (this.isTerminal(job.status)) {
            job.completedAt = job.completedAt ?? Date.now();
            this.abortControllers.delete(id);
        }
        // Emit exactly one event per updateJob call to prevent SSE double-write
        if (update.status !== undefined && isTerminalJobStatus(update.status)) {
            // Terminal event takes precedence — don't also emit the progress event
            this.emitter.emit(`progress:${id}`, {
                phase: update.status,
                percent: update.status === 'complete' ? 100 : job.progress.percent,
                message: update.status === 'complete' ? 'Complete' : update.error || 'Failed',
            });
        }
        else if (update.progress) {
            this.emitter.emit(`progress:${id}`, update.progress);
        }
    }
    /** Register a child process for a job — enables cancellation and timeout. */
    registerChild(jobId, child) {
        this.children.set(jobId, child);
        // 30-minute timeout
        const timer = setTimeout(() => {
            const job = this.jobs.get(jobId);
            if (job && !this.isTerminal(job.status)) {
                this.cancelJob(jobId, 'Analysis timed out (30 minute limit)');
            }
        }, JOB_TIMEOUT_MS);
        this.timeouts.set(jobId, timer);
        // Clean up tracking when child exits
        child.on('exit', () => {
            this.children.delete(jobId);
            const t = this.timeouts.get(jobId);
            if (t) {
                clearTimeout(t);
                this.timeouts.delete(jobId);
            }
        });
    }
    /** Register cancellable in-process work for a job. */
    registerAbortController(jobId, controller) {
        const job = this.jobs.get(jobId);
        if (!job || this.isTerminal(job.status)) {
            controller.abort();
            return;
        }
        this.abortControllers.set(jobId, controller);
    }
    /** Cancel a running job — sends SIGTERM to child process. */
    cancelJob(jobId, reason) {
        const job = this.jobs.get(jobId);
        if (!job || this.isTerminal(job.status))
            return false;
        const child = this.children.get(jobId);
        if (child) {
            child.kill('SIGTERM');
        }
        this.abortControllers.get(jobId)?.abort();
        this.abortControllers.delete(jobId);
        this.updateJob(jobId, {
            status: 'failed',
            error: reason || 'Analysis cancelled',
        });
        return true;
    }
    /** Subscribe to progress events for a job. Returns unsubscribe function. */
    onProgress(jobId, listener) {
        const event = `progress:${jobId}`;
        this.emitter.on(event, listener);
        return () => this.emitter.off(event, listener);
    }
    dispose() {
        // Kill all active child processes
        for (const child of this.children.values()) {
            child.kill('SIGTERM');
        }
        this.children.clear();
        for (const controller of this.abortControllers.values())
            controller.abort();
        this.abortControllers.clear();
        // Clear all timeouts
        for (const timer of this.timeouts.values()) {
            clearTimeout(timer);
        }
        this.timeouts.clear();
        clearInterval(this.cleanupTimer);
        this.emitter.removeAllListeners();
    }
    isTerminal(status) {
        return isTerminalJobStatus(status);
    }
    cleanup() {
        const now = Date.now();
        for (const [id, job] of this.jobs) {
            if (this.isTerminal(job.status) && job.completedAt && now - job.completedAt > JOB_TTL_MS) {
                this.jobs.delete(id);
                this.abortControllers.delete(id);
            }
        }
    }
}
