/**
 * Analyze Command
 *
 * Indexes a repository and stores the knowledge graph in .gitnexus/
 *
 * Delegates core analysis to the shared runFullAnalysis orchestrator.
 * This CLI wrapper handles: heap management, progress bar, SIGINT,
 * skill generation (--skills), summary output, and process.exit().
 */
import { type AnalyzerRunnerIdentity } from '../storage/repo-manager.js';
import type { AnalyzeOptions } from './analyze-options.js';
/**
 * RAM-aware re-exec heap cap (MB) — the formula itself is single-sourced in
 * `core/ingestion/utils/effective-ram.ts` (`heapCapMbFor`), shared with the
 * server's analyze fork. `constrainedBytes` is the cgroup limit or `null`;
 * it is honored only as a real, smaller-than-physical cap, because
 * `process.constrainedMemory()` returns a huge sentinel when UNCONSTRAINED.
 * (Observed rationale: a cap ≥ RAM made V8 collect lazily and swap-thrash —
 * the #2649 worker-timeout cascade on 16 GB boxes.)
 */
export declare function computeHeapCapMb(totalBytes: number, constrainedBytes: number | null): number;
/**
 * Last `--max-old-space-size` value (MB) in a NODE_OPTIONS string, or `null`
 * when absent/unparseable. Last occurrence wins, matching V8's own
 * later-flag-wins semantics when NODE_OPTIONS repeats a flag.
 */
export declare function parseMaxOldSpaceMb(nodeOptions: string): number | null;
/**
 * CLI `analyze` flag shape. Defined in `./analyze-options.js` so
 * `analyze-config.ts` can reference it without importing this module back —
 * that type import closed a cycle over `analyze` → `analyze-config` and
 * `analyze` → `run-analyze` → `analyze-config`. Re-exported here because this
 * is where callers have always imported it from.
 */
export type { AnalyzeOptions };
/**
 * Whether the post-index skill step should run.
 *
 * The gated block does two things in sequence: (1) generates the community
 * skill files from `--skills`, and (2) re-runs `generateAIContextFiles` so
 * AGENTS.md/CLAUDE.md can reference the freshly written skills. Both are
 * suppressed together — `--index-only` drops the entire step, not just the
 * community-skill write. Name retained for the test contract; see call site
 * in `analyzeCommand` for the AGENTS.md/CLAUDE.md re-generation it also gates.
 *
 * Kept as a pure helper so the `--index-only --skills` contract is unit-tested
 * without booting the full analyze pipeline (#742 review).
 */
export declare const shouldGenerateCommunitySkillFiles: (options: Pick<AnalyzeOptions, "skills" | "indexOnly"> | undefined, pipelineResult: unknown) => boolean;
export declare const analyzeCommand: (inputPath?: string, options?: AnalyzeOptions, runnerIdentityAtBootstrap?: AnalyzerRunnerIdentity) => Promise<void>;
/** Commander entrypoint used only by the capture-before-import lazy bootstrap. */
export declare const analyzeCommandWithRunnerIdentity: (runnerIdentityAtBootstrap: AnalyzerRunnerIdentity, inputPath?: string, options?: AnalyzeOptions) => Promise<void>;
