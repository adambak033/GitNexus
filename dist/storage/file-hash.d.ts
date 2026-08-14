/**
 * Per-file content hashing for incremental DB writeback.
 *
 * On every analyze run we compute SHA-256 of every file's content and
 * store the map in meta.json. The next run compares disk against the
 * stored map and produces:
 *   - `changed` — content differs (re-emit DB rows for this file)
 *   - `added`   — file is new on disk (insert DB rows)
 *   - `deleted` — file was in last meta but no longer on disk (drop rows)
 *
 * The pipeline still parses every file (correctness invariant: cross-file
 * resolution needs full data). What this enables is a SELECTIVE DB
 * writeback: instead of wipe-and-reload of the whole graph (~50s of CSV
 * COPY on a 25K-node repo), we only delete-and-rewrite rows for the
 * changed/added/deleted set.
 *
 * See docs/superpowers/specs/2026-05-10-incremental-indexing-design.md
 * (Option B revision).
 */
/**
 * Compute SHA-256 of a single file. Returns null when the file can't be
 * read — caller treats that as "no signature, assume changed".
 */
export declare const computeFileHash: (absPath: string) => Promise<string | null>;
/**
 * Compute SHA-256 hashes for many files in parallel batches. Files that
 * fail to read are omitted from the result map.
 */
export declare const computeFileHashes: (repoPath: string, relPaths: readonly string[]) => Promise<Map<string, string>>;
/** Result of comparing the current on-disk hashes against stored ones. */
export interface FileHashDiff {
    /** Files whose content hash differs from stored. */
    changed: string[];
    /** Files in the current scan that weren't in the stored map. */
    added: string[];
    /** Files in the stored map that aren't in the current scan. */
    deleted: string[];
    /** All files whose DB rows must be replaced (changed ∪ added). */
    toWrite: string[];
}
/**
 * Diff a current hash map against a previously stored one.
 *
 * Sorted output so two runs produce identical diff arrays for the same
 * changes — useful for stable logging / equivalence checks.
 */
export declare const diffFileHashes: (current: ReadonlyMap<string, string>, stored: Readonly<Record<string, string>> | undefined) => FileHashDiff;
