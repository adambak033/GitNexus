/**
 * Shared analyze-worker launcher.
 *
 * Forks the analyze worker for an already-resolved repo directory and owns the
 * lock + auto-retry + IPC machinery. Used by both the JSON `/api/analyze` route
 * and the multipart `/api/analyze/upload` route. Dependency-injected (like
 * createAnalyzeUploadHandler) so the seam is testable and api.ts stays smaller.
 *
 * NOTE: this module must live alongside analyze-worker.{ts,js} — the worker
 * path is resolved relative to `import.meta.url`.
 */
import { type JobManager } from './analyze-job.js';
export interface LaunchDeps {
    jobManager: JobManager;
    backend: {
        init: () => Promise<unknown>;
    };
    acquireRepoLock: (key: string) => string | null;
    releaseRepoLock: (key: string) => void;
    /**
     * Drops the server's cached LadybugDB handle (closeLbug). The worker
     * process rewrites the repo's DB files on disk, so a connection opened
     * before the rewrite keeps reading the pre-rewrite state until evicted.
     */
    closeDbHandle: () => Promise<void>;
}
export interface LaunchOptions {
    force?: boolean;
    embeddings?: boolean;
    dropEmbeddings?: boolean;
    registryName?: string;
}
export declare function createLaunchAnalysisWorker(deps: LaunchDeps): (job: {
    id: string;
}, targetPath: string, opts: LaunchOptions) => void;
