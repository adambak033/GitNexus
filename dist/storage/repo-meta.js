/**
 * Repo metadata primitives — the bottom layer of `storage/`.
 *
 * Holds the on-disk shape of a GitNexus index's metadata file
 * (`.gitnexus/gitnexus.json`, plus its legacy `meta.json` mirror) and the
 * read-side helpers that locate and parse it. Nothing here writes, and nothing
 * here knows about the global registry.
 *
 * Why it is its own module: `repo-manager.ts` owns the registry and the write
 * side, and `branch-index.ts` (#2106) owns the multi-branch slug/placement
 * logic — but `resolveBranchPlacement` has to READ the flat slot's metadata to
 * decide who owns it. That made `branch-index` import values back out of
 * `repo-manager`, which imports values out of `branch-index`: a genuine
 * two-way runtime cycle that was only ESM-safe because neither side touched the
 * other at module-evaluation time. Rather than keep relying on that timing,
 * the shared read primitives moved DOWN here, where both layers can import them
 * and neither imports the other back.
 *
 * `repo-manager.ts` re-exports the public names (`RepoMeta`,
 * `AnalyzerRunnerIdentity`, `getStoragePath`, `loadMeta`, `INDEX_METADATA_FILE`,
 * `isMissingFilesystemError`) so every existing import site keeps working
 * unchanged.
 *
 * Imports `node:fs`/`node:path` and two type-only shapes. Keep it that way: a
 * value import here would land in every consumer of `storage/`.
 */
import fs from 'fs/promises';
import path from 'path';
/** The `.gitnexus` directory name, relative to a repo root. */
export const GITNEXUS_DIR = '.gitnexus';
export const INDEX_METADATA_FILE = 'gitnexus.json';
// Dual-written mirror of INDEX_METADATA_FILE, kept for backward compatibility
// with consumers that only know the pre-rename filename (see MIGRATION.md).
export const LEGACY_METADATA_FILE = 'meta.json';
/**
 * Get the .gitnexus storage path for a repository.
 * Used for local metadata and caches that are not committed.
 */
export const getStoragePath = (repoPath) => {
    return path.join(path.resolve(repoPath), GITNEXUS_DIR);
};
/**
 * True for errors that prove a path is absent (ENOENT/ENOTDIR) — as opposed
 * to transient/permission failures (EIO/EACCES/EBUSY…) where the file may
 * well still exist. Exported for consumers that need the same "provably
 * missing vs not provably absent" distinction (e.g. collectBranchCacheKeys).
 */
export function isMissingFilesystemError(err) {
    const code = err?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
/**
 * Best-effort read of one specific metadata filename — no fallback, null on
 * any failure (absent, unreadable, or unparseable).
 */
export const tryReadMetaFile = async (dir, filename) => {
    try {
        const raw = await fs.readFile(path.join(dir, filename), 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
};
/**
 * Load metadata from the legacy `meta.json` mirror in the given directory.
 * Returns null when the file is absent, unreadable, or unparseable — a
 * corrupt legacy file is treated the same as a missing one (safe rebuild).
 */
const loadMetaLegacy = async (metaDir) => tryReadMetaFile(metaDir, LEGACY_METADATA_FILE);
/**
 * Load metadata from a directory containing the metadata file (gitnexus.json).
 * For primary/flat: metaDir = <repo>/.gitnexus
 * For feature branches: metaDir = <repo>/.gitnexus/branches/<slug>
 *
 * Falls back to the legacy `meta.json` mirror ONLY when `gitnexus.json` is
 * provably absent (ENOENT/ENOTDIR). Any other failure — a parse error, EACCES,
 * EIO — returns null instead of silently resurrecting possibly-stale legacy
 * content: a corrupt primary file must trigger the same safe full-rebuild path
 * a missing index would (the fail-safe `saveMeta`'s docstring relies on), not
 * an incremental run over a stale legacy baseline.
 */
export const loadMeta = async (metaDir) => {
    let raw;
    try {
        raw = await fs.readFile(path.join(metaDir, INDEX_METADATA_FILE), 'utf-8');
    }
    catch (err) {
        // Provably absent → the legacy mirror is the source of truth (pre-rename
        // repo, or a mirror-only state). Anything else → fail safe with null.
        return isMissingFilesystemError(err) ? loadMetaLegacy(metaDir) : null;
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        // Corrupt primary file — do NOT mask it with legacy content.
        return null;
    }
};
