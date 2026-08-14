/**
 * POST /api/analyze/upload — analyze a browser folder upload.
 *
 * Securely ingests the multipart upload into a sandbox (upload-ingest.ts),
 * promotes it to a persistent app-controlled directory, and analyzes it via
 * the same job/worker machinery as a git clone — never returning a server
 * path to the client. Factored as a dependency-injected handler so the job
 * machinery (createJob + the worker launcher) can be mocked in unit tests.
 */
import type { Request, Response } from 'express';
import { ingestUpload } from './upload-ingest.js';
import type { AnalyzeJob } from './analyze-job.js';
/** Minimal job shape the handler needs (a subset of the real AnalyzeJob). */
export type UploadJobRef = Pick<AnalyzeJob, 'id' | 'status'>;
export interface AnalyzeUploadDeps {
    /** Create (or throw on busy) an analysis job for the given upload dir. */
    createJob: (params: {
        repoPath: string;
    }) => UploadJobRef;
    /** Launch the analyze worker against an already-resolved repo directory. */
    launch: (job: UploadJobRef, targetPath: string, opts: {
        registryName: string;
    }) => void;
    /**
     * Mark a created job failed. The job occupies the single analysis slot from
     * createJob onward, so ANY error before launch must release it — otherwise a
     * leaked non-terminal job wedges all future analyses until restart.
     */
    failJob: (jobId: string, error: string) => void;
    /** Injectable for tests (defaults to the real ingestUpload). */
    ingest?: typeof ingestUpload;
}
export declare function createAnalyzeUploadHandler(deps: AnalyzeUploadDeps): (req: Request, res: Response) => Promise<void>;
