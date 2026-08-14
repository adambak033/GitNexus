/**
 * Shadow-candidate path derivation for incremental indexing.
 *
 * Background — Bugbot review on PR #1479:
 *   the importer BFS (queryImportersBatch) on a NEWLY ADDED file returns
 *   0 importers in the pre-pipeline DB, because the new file's IMPORTS
 *   rows haven't been written yet. But pre-existing files may have IMPORTS edges that
 *   *resolved to a sibling path*, and the newcomer can now steal that
 *   resolution under standard JS/TS module-resolution rules. Without
 *   pulling those pre-existing files into the writable set, their
 *   stale CALLS edges remain pointing at the OLD resolution target.
 *
 * Given an added file path, this helper enumerates the pre-existing
 * file paths whose import-resolution claim the newcomer can steal.
 * Caller filters the candidates against the prior-run `fileHashes`
 * map so we only query importers of paths that actually existed.
 *
 * Shadow patterns covered (resolution-priority-aware):
 *
 *   (a) Same basename, different extension —
 *       added `foo/bar.ts` shadows `foo/bar.{tsx,js,jsx,mjs,cjs,d.ts}`.
 *   (b) Bare-file beats directory-style index —
 *       added `foo/bar.ts` shadows `foo/bar/index.{ts,tsx,...}`.
 *   (c) Directory-index beats bare-file —
 *       added `foo/index.ts` shadows `foo.{ts,tsx,...}` (rare but real,
 *       e.g. converting a single-file module into a directory module).
 *
 * Resolution-order priority is conservatively wide: we enumerate ALL
 * common extensions because we don't know which the importer actually
 * specified, and over-seeding is harmless (extra BFS work, but the
 * subgraph extract still gates write-back by file membership).
 *
 * Cross-platform path separators: candidates are emitted with both `/`
 * and `\` for shadow pattern (b), since the caller's prior fileHashes
 * map may use either depending on the OS that wrote it.
 */
/**
 * Enumerate pre-existing paths whose import-resolution `added` can steal.
 *
 * @param added — repo-relative path of a newly-added file
 * @returns deduplicated list of candidate paths (NOT filtered against
 *          any known-files set — caller does that)
 */
export declare const shadowCandidatesFor: (added: string) => string[];
