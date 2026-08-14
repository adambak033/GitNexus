/**
 * Index Command
 *
 * Registers an existing GitNexus index into the global registry so the
 * MCP server can discover the repo without running a full `gitnexus analyze`.
 *
 * The index can be either:
 * - A per-worktree gitnexus.json file under .gitnexus/ (new format, worktree-compatible)
 * - A legacy .gitnexus/meta.json file (auto-migrated on analyze)
 *
 * Useful when a pre-built index is already present (e.g. after
 * cloning a repo that ships its index, restoring from backup, or using a
 * shared team index).
 */
export interface IndexOptions {
    force?: boolean;
    allowNonGit?: boolean;
}
export declare const indexCommand: (inputPathParts?: string[], options?: IndexOptions) => Promise<void>;
