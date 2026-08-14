import { type RegistryEntry } from '../../storage/repo-manager.js';
import type { GroupConfig, RepoHandle, RepoSnapshot, StoredContract, CrossLink, GroupManifestLink } from './types.js';
export interface SyncOptions {
    extractorOverride?: ((repo: RepoHandle) => Promise<StoredContract[]>) | (() => Promise<StoredContract[]>);
    resolveRepoHandle?: (registryName: string, groupPath: string) => Promise<RepoHandle | null>;
    skipWrite?: boolean;
    groupDir?: string;
    allowStale?: boolean;
    verbose?: boolean;
    exactOnly?: boolean;
    skipEmbeddings?: boolean;
}
export interface SyncResult {
    contracts: StoredContract[];
    crossLinks: CrossLink[];
    unmatched: StoredContract[];
    missingRepos: string[];
    repoSnapshots: Record<string, RepoSnapshot>;
}
export declare function stableRepoPoolId(entry: RegistryEntry, allEntries: RegistryEntry[]): string;
/** A batch of manifest links whose referenced in-group repos fit one resident window. */
export interface ManifestWindow {
    links: GroupManifestLink[];
    /** In-group repos (group paths) this window's links reference; size ≤ maxResident. */
    repos: Set<string>;
}
/**
 * Partition manifest links into windows so each window references at most
 * `maxResident` distinct in-group repos. Manifest resolution then materializes
 * only one window's repos at a time, bounding peak pool residency regardless of
 * group size (PR #2191 review, Finding 3 — windowed deferred resolution).
 *
 * Each link references ≤2 in-group repos, so every link fits a window when
 * `maxResident ≥ 2`. Links are pre-sorted by their referenced-repo key so links
 * sharing a repo land in contiguous windows — combined with release-not-close
 * pooling, a hub repo stays warm across the windows that reference it (its
 * lease is released, not closed, so the next window's initLbug fast-paths it).
 * Every link lands in EXACTLY one window (a true partition): downstream
 * dedupeCrossLinks dedupes cross-links but not contracts, so a link in two
 * windows would emit duplicate contracts nothing absorbs.
 *
 * Repos not in `knownRepos` (dangling / unresolved) add 0 to a window's repo
 * budget — the link is still placed (so it yields synthetic-UID contracts), it
 * just consumes no residency.
 */
export declare function partitionManifestWindows(links: GroupManifestLink[], knownRepos: Set<string>, maxResident: number): ManifestWindow[];
export declare function syncGroup(config: GroupConfig, opts?: SyncOptions): Promise<SyncResult>;
