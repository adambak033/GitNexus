import type { CypherExecutor } from '../contract-extractor.js';
import type { GroupManifestLink } from '../types.js';
/**
 * Discover cross-crate contracts in a Rust workspace by reading each
 * member's `Cargo.toml` dependencies and scanning source files for
 * `use <workspace_dep>::<Type>` imports.
 *
 * Emits `GroupManifestLink[]` with `type: 'custom'` that feed into the
 * existing ManifestExtractor pipeline — no new matching logic needed.
 *
 * Designed for the group-level sync pipeline: it receives all repos in
 * a group and produces cross-repo links between them.
 */
interface CrateMeta {
    name: string;
    groupPath: string;
    repoPath: string;
    workspaceDeps: string[];
}
/**
 * Linear-time `[package].name = "..."` lookup. The previous regex
 * `^\[package\]\s*\n(?:[^\[]*?\n)*?name\s*=\s*"([^"]+)"` had a nested
 * lazy quantifier on `\n` that CodeQL js/redos flagged as exponential
 * on inputs like `[package]\n` + many bare `\n`. We walk lines
 * explicitly: scan from the first `[package]` header until we hit the
 * next `[...]` section header, looking for the `name = "..."` line.
 * O(n) with the line count.
 *
 * Exported so the U8 ReDoS regression test can drive the production
 * line-walk directly with adversarial fixtures (multi-line strings,
 * trailing sections, etc.) instead of duplicating it inline.
 */
export declare function parseCargoPackageName(content: string): string | null;
export interface RustWorkspaceResult {
    links: GroupManifestLink[];
    discoveredCrates: Map<string, CrateMeta>;
}
/**
 * Discover cross-crate contracts across all Rust repos in a group.
 *
 * Returns `GroupManifestLink[]` ready to feed into `ManifestExtractor`.
 */
export declare function extractRustWorkspaceLinks(repos: Record<string, string>, repoPaths: Map<string, string>, _dbExecutors?: Map<string, CypherExecutor>): Promise<RustWorkspaceResult>;
export {};
