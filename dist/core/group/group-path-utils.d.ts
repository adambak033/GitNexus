/**
 * Shared service-path normalization for group tools (`service` monorepo filter)
 * and subgroup membership checks.
 *
 * Inputs may originate from tree-sitter, the OS file API, or user-supplied
 * MCP arguments, so both `\` and `/` separators are accepted. Internally we
 * normalize to POSIX-style `/` for case-sensitive segment comparisons.
 */
export declare function normalizeServicePrefix(service: unknown): string | undefined;
export declare function fileMatchesServicePrefix(filePath: string | undefined, prefix: string | undefined): boolean;
/**
 * True if `repoPath` is at or beneath `subgroup` (member-path prefix in
 * `group.yaml`). Empty / missing `subgroup` matches every repo.
 *
 * @param exact When set, requires an exact equality match (no descendant repos).
 */
export declare function repoInSubgroup(repoPath: string, subgroup?: string, exact?: boolean): boolean;
