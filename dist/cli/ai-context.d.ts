/**
 * AI Context Generator
 *
 * Creates AGENTS.md and CLAUDE.md with full inline GitNexus context.
 * AGENTS.md is the standard read by Cursor, Windsurf, OpenCode, Codex, Cline, CodeBuddy, Qoder, etc.
 * CLAUDE.md is for Claude Code which only reads that file.
 */
import { type GeneratedSkillInfo } from './generated-skill.js';
interface RepoStats {
    files?: number;
    nodes?: number;
    edges?: number;
    communities?: number;
    clusters?: number;
    processes?: number;
}
export interface AIContextOptions {
    skipAgentsMd?: boolean;
    noStats?: boolean;
    skipSkills?: boolean;
    /**
     * Default branch used by the generated regression-compare example (#243).
     * Resolved by the CLI (CLI flag > `.gitnexusrc` > auto-detect > "main"); a
     * plain caller that omits it gets "main", preserving prior behavior.
     */
    defaultBranch?: string;
    /**
     * Whether the index was built with `--pdg` (#2086 M6). Gates the `pdg_query`
     * line in the generated block — without the PDG layer the tool only returns a
     * "no PDG layer" note, so advertising it on a non-`--pdg` index is noise.
     */
    hasPdg?: boolean;
}
/**
 * Strip backticks from a branch name before it is embedded in a Markdown
 * inline-code span (#1996 tri-review P1). validateBranchName already rejects
 * backticks for CLI/config/auto-detect inputs; this is the last-line defense at
 * the generation sink so the embedding is provably safe regardless of caller.
 */
export declare function markdownSafeBranch(branch: string): string;
/** Options for {@link generateGitNexusContent} (collapsed from positional
 *  params, #2188 review — six `undefined`s to reach `hasPdg` was the smell). */
export interface GitNexusContentOptions {
    generatedSkills?: GeneratedSkillInfo[];
    groupNames?: string[];
    noStats?: boolean;
    skipSkills?: boolean;
    /** Project-relative path to the runner `gitnexus analyze` drops next to the
     *  index (#1945). Referenced by docs so a single CLI-neutral command resolves
     *  the available runner (global `gitnexus` → `pnpm dlx` → `bunx` → `npx`) at
     *  call time. */
    runnerPath?: string;
    /** Default branch for the regression-compare example (#243). Configurable so
     *  projects on `develop`/`master`/etc. don't get `base_ref: "main"` rewritten
     *  back over their fix on every analyze. The value is embedded inside a
     *  Markdown inline-code span: validateBranchName rejects backticks upstream,
     *  and `markdownSafeBranch` strips any remaining backtick here as defense in
     *  depth, so JSON.stringify's quote/escape handling is sufficient and the
     *  branch cannot break out of the span (#1996 tri-review P1). */
    defaultBranch?: string;
    /** Whether the index was built with `--pdg` (#2086 M6). Gates the pdg_query
     *  line below — false (default) omits it, so a non-pdg index doesn't advertise
     *  a tool that only returns a "no PDG layer" note. */
    hasPdg?: boolean;
}
export declare function generateGitNexusContent(projectName: string, stats: RepoStats, opts?: GitNexusContentOptions): string;
/**
 * Some agents read skills from a repo-local `.agents/skills/` directory and
 * prefer it over the global `~/.agents/skills/` install. When the repo contains
 * an `.agents/` directory, skills written to `.claude/skills/` are mirrored
 * there too so those agents serve the up-to-date copies.
 */
export declare function shouldMirrorSkillsToAgents(repoPath: string): Promise<boolean>;
/**
 * Generate AI context files after indexing
 */
export declare function generateAIContextFiles(repoPath: string, storagePath: string, projectName: string, stats: RepoStats, generatedSkills?: GeneratedSkillInfo[], options?: AIContextOptions): Promise<{
    files: string[];
}>;
/**
 * Refresh only the `base_ref: "..."` value inside the GitNexus block of an
 * already-generated AGENTS.md / CLAUDE.md, in place (#1996 tri-review P2).
 *
 * The `alreadyUpToDate` analyze fast path returns before the normal
 * {@link generateAIContextFiles} call, so a changed `.gitnexusrc` defaultBranch
 * (or `--default-branch`) would otherwise not take effect until the next
 * re-index. This does a surgical line update that preserves the rest of the
 * block — including community-skill rows written by a prior `--skills` run —
 * rather than regenerating (which would drop those rows on a no-`--skills` run).
 *
 * Best-effort: missing files, a missing/blank block, or a block with no
 * `base_ref` line (e.g. a user-trimmed keep block) are silently skipped. Writes
 * only when the value actually changes, so a routine up-to-date run is a no-op.
 */
export declare function refreshBaseRefLine(repoPath: string, defaultBranch: string, options?: {
    skipAgentsMd?: boolean;
}): Promise<{
    files: string[];
}>;
export {};
