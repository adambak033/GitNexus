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
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { chunk } from '../lib/utils.js';
/**
 * Compute SHA-256 of a single file. Returns null when the file can't be
 * read — caller treats that as "no signature, assume changed".
 */
export const computeFileHash = async (absPath) => {
    try {
        const buf = await fs.readFile(absPath);
        return createHash('sha256').update(buf).digest('hex');
    }
    catch {
        return null;
    }
};
/**
 * Compute SHA-256 hashes for many files in parallel batches. Files that
 * fail to read are omitted from the result map.
 */
export const computeFileHashes = async (repoPath, relPaths) => {
    const out = new Map();
    const BATCH = 100;
    for (const batch of chunk(relPaths, BATCH)) {
        const results = await Promise.all(batch.map(async (rel) => {
            const h = await computeFileHash(path.join(repoPath, rel));
            return h ? [rel, h] : null;
        }));
        for (const r of results)
            if (r)
                out.set(r[0], r[1]);
    }
    return out;
};
/**
 * Diff a current hash map against a previously stored one.
 *
 * Sorted output so two runs produce identical diff arrays for the same
 * changes — useful for stable logging / equivalence checks.
 */
export const diffFileHashes = (current, stored) => {
    const storedMap = new Map(stored ? Object.entries(stored) : []);
    const changed = [];
    const added = [];
    for (const [p, h] of current) {
        const prev = storedMap.get(p);
        if (prev === undefined)
            added.push(p);
        else if (prev !== h)
            changed.push(p);
    }
    const deleted = [];
    for (const p of storedMap.keys()) {
        if (!current.has(p))
            deleted.push(p);
    }
    changed.sort();
    added.sort();
    deleted.sort();
    return {
        changed,
        added,
        deleted,
        toWrite: [...changed, ...added].sort(),
    };
};
