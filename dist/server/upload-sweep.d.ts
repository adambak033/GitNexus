/**
 * Backstop cleanup for abandoned upload staging directories.
 *
 * A crashed/killed process can leave a `.staging-*` directory under
 * UPLOAD_ROOT (the normal path removes it on success/failure/abort). This
 * sweep, run once at server startup, removes staging dirs older than a
 * threshold. Promoted upload dirs are persistent registered repos (like
 * clones) and are NOT touched here — they are removed via DELETE /api/repo.
 */
export interface SweepOptions {
    /** Remove staging dirs older than this (default 6h). */
    maxAgeMs?: number;
    /** Override the root to sweep (defaults to UPLOAD_ROOT; for tests). */
    root?: string;
    /** Clock injection for tests. */
    now?: number;
}
export declare function sweepStaleUploads(opts?: SweepOptions): Promise<{
    removed: string[];
}>;
