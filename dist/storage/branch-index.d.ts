/**
 * Branch-index primitives (#2106).
 *
 * Extracted from `repo-manager.ts` to keep the multi-branch slug/placement
 * logic in one focused module. The registry I/O and the metadata WRITE side
 * stay in `repo-manager.ts`, which re-exports these so existing import sites
 * keep working unchanged.
 *
 * The metadata READ primitives this module needs (`getStoragePath`, `loadMeta`,
 * `RepoMeta`) come from `repo-meta.ts`, a leaf below both modules — NOT from
 * `repo-manager.ts`. Importing them from there made the two modules import
 * values out of each other, and the only thing keeping that ESM-safe was that
 * neither side called across at module-evaluation time. Reading from the layer
 * below removes the cycle instead of depending on that timing.
 */
import { type RepoMeta } from './repo-meta.js';
/**
 * Per-branch index summary nested under a registry entry (#2106). Records
 * non-primary branches indexed for the same repo path so `list`, `status`, and
 * `list_repos` can surface them without a second registry entry.
 */
export interface BranchSummary {
    /** Git branch name this sub-index represents. */
    branch: string;
    indexedAt: string;
    lastCommit: string;
    stats?: RepoMeta['stats'];
}
/** Branch-index sub-directory name, relative to the flat `.gitnexus` storage. */
export declare const BRANCHES_DIR = "branches";
/**
 * Filesystem-safe slug for a git branch ref (#2106).
 *
 * `sanitizeRepoName` alone is lossy — it maps `/`→`_`, so `feature/x` and
 * `feature_x` would collide into the same directory. We append a short sha256
 * of the RAW ref (mirroring `assignRepoId`'s digest fallback) so two distinct
 * refs can never share a branch directory, while keeping the human prefix
 * readable.
 */
export declare const branchSlug: (rawRef: string) => string;
/**
 * Decide where an EXPLICIT `--branch` run's index lives: the flat workspace
 * slot or a per-branch sub-directory (#2106 KTD2, #2354).
 *
 * Only explicit `--branch` runs consult this — a plain analyze always targets
 * the flat slot, which follows the checked-out working tree (#2354; gated at
 * the `runFullAnalysis` call site). Returns `{}` for the flat placement
 * (byte-identical layout) or `{ branch }` for a `branches/<slug>/`
 * sub-directory: when the requested label matches the flat slot's recorded
 * `branch` label the run updates the flat slot in place (identical content —
 * `--branch` requires the label to be checked out); any other label gets its
 * own pinned sub-directory that plain analyzes won't touch.
 *
 * A `null` label — detached HEAD, non-git folder, or CI checkout — always
 * maps to the flat slot.
 */
export declare const resolveBranchPlacement: (repoPath: string, label: string | null) => Promise<{
    branch?: string;
}>;
