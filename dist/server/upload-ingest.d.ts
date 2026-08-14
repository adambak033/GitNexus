/**
 * Secure ingestion of a browser folder upload (multipart/form-data).
 *
 * Replaces the path-injection-prone GET /api/fs/list directory listing. The
 * client streams the selected files plus a JSON `manifest` of their
 * webkitRelativePaths; we write each into an mkdtemp staging dir under
 * UPLOAD_ROOT with PROVABLE containment (resolve-then-contain), hard resource
 * caps, and guaranteed cleanup on every failure/abort path. No client value
 * ever reaches a filesystem READ — the server only writes into a sandbox it
 * created, then hands that sandbox to the analysis pipeline.
 *
 * Security references: CodeQL js/path-injection (resolve + startsWith(root+sep)),
 * OWASP File Upload / Path Traversal.
 */
import type { IncomingMessage } from 'http';
export interface IngestLimits {
    /** Aggregate bytes across all files (busboy has no aggregate limit). */
    maxTotalBytes: number;
    /** Per-file byte cap. */
    maxFileBytes: number;
    /** Maximum number of files. */
    maxFiles: number;
    /** Maximum multipart parts (files + fields). */
    maxParts: number;
    /** Maximum directories created (inode-exhaustion guard). */
    maxDirs: number;
    /** Maximum size of the manifest field. */
    maxFieldBytes: number;
}
export declare const DEFAULT_INGEST_LIMITS: IngestLimits;
export interface IngestResult {
    /** Absolute path to the populated staging directory (realpath-canonical). */
    stageRoot: string;
    fileCount: number;
    totalBytes: number;
    /** First path segment shared by the uploaded tree (the picked folder). */
    topLevelName: string;
}
/**
 * Resolve a client-provided relative path to an absolute destination PROVABLY
 * contained within `stageRoot`. Throws BadRequestError on any unsafe input.
 * This is the load-bearing path-traversal-on-write control; keep it pure and
 * unit-tested.
 */
export declare function resolveContainedDest(stageRoot: string, rel: unknown): string;
export interface IngestOptions {
    /** Override the staging parent dir (defaults to UPLOAD_ROOT; for tests). */
    root?: string;
}
/**
 * Parse and securely write a multipart folder upload into a fresh staging
 * directory under UPLOAD_ROOT. Resolves with the populated staging dir, or
 * rejects with a BadRequestError (status 400/413) after removing the staging
 * dir. The caller owns promotion + cleanup of the returned `stageRoot`.
 */
export declare function ingestUpload(req: IncomingMessage, limitsOverride?: Partial<IngestLimits>, opts?: IngestOptions): Promise<IngestResult>;
