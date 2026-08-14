/**
 * Summary-harvest driver (#2084 M4 U1) — the in-phase orchestration that turns
 * per-function CFGs into call-graph-keyed {@link FunctionSummary} objects.
 *
 * Runs inside the scope-resolution pdg window (alongside `emitFileTaint`),
 * where both the live CFG side channel AND the structure-phase `Function` /
 * `Method` graph nodes are available. For each emit-safe CFG it:
 *
 * 1. resolves the CFG's source anchor `(filePath, functionStartLine)` to its
 *    graph node id, so the summary speaks the call graph's language directly —
 *    the interprocedural fixpoint then joins summaries to `CALLS` edges by node
 *    id with no fragile re-derivation;
 * 2. runs the pure {@link harvestFunctionSummary} over the same RD facts +
 *    matched sites the M3 taint pass uses;
 * 3. stamps the own-facts `version` (#2084 review P1-1: callee-version
 *    composition is RESERVED — the fixpoint does not recompute it today).
 *
 * ## The Function↔CFG join (load-bearing)
 *
 * `FunctionCfg.functionStartLine` is 1-based (the TS visitor's `row + 1`);
 * `Function`/`Method` node `startLine` is 0-based (`startPosition.row`). The
 * join therefore looks up node start line `functionStartLine - 1`
 * ({@link NODE_TO_CFG_LINE_OFFSET}). Function nodes carry no start column, so a
 * `(filePath, startLine)` collision — two functions opening on one line,
 * `{ a: () => x(), b: () => y() }` — is ambiguous: the CFG disambiguates with
 * `functionStartColumn` but the node does not, so a colliding anchor is DROPPED
 * (counted as `unresolved`) rather than risk attaching a summary to the wrong
 * function. Rare in practice; the alternative (cross-wired summaries) is unsound.
 */
import type { ParsedImport } from '../../../_shared/index.js';
import type { KnowledgeGraph } from '../../graph/types.js';
import { type ReachingDefsSolver } from '../cfg/reaching-defs.js';
import type { FunctionCfg } from '../cfg/types.js';
import type { SourceSinkSanitizerSpec } from './source-sink-config.js';
import { type FunctionSummary } from './summary-model.js';
import type { CallSummary } from './call-summary-model.js';
/** `cfg.functionStartLine` (1-based) − this = the node's 0-based `startLine`. */
export declare const NODE_TO_CFG_LINE_OFFSET = 1;
/**
 * Index of functionish graph nodes by `filePath → startLine(0-based) → ids`.
 * Built ONCE per scope-resolution pass (the graph is whole-repo); reused across
 * every file's harvest.
 */
export type FunctionNodeIndex = ReadonlyMap<string, ReadonlyMap<number, readonly string[]>>;
export declare function buildFunctionNodeIndex(graph: KnowledgeGraph): FunctionNodeIndex;
export interface FileSummaryResult {
    readonly summaries: readonly FunctionSummary[];
    /** CFGs whose anchor resolved to no unique graph node (collision / missing). */
    readonly unresolved: number;
    /** CFGs whose reaching-defs were not `computed` (no summary produced). */
    readonly gaps: number;
}
/**
 * Harvest summaries for one file's emit-safe CFGs. `cfgs` MUST already be
 * `isEmitSafeCfg`-filtered (the same `wellFormed` array fed to `emitFileTaint`).
 * Pure aside from the read-only graph lookup; never throws on valid input.
 */
export declare function harvestFileSummaries(fnIndex: FunctionNodeIndex, cfgs: readonly FunctionCfg[], parsedImports: readonly ParsedImport[], spec: SourceSinkSanitizerSpec, maxFacts?: number, solve?: ReachingDefsSolver): FileSummaryResult;
export interface FileCallSummaryResult {
    readonly summaries: readonly CallSummary[];
    /** CFGs whose anchor resolved to no unique graph node (collision / missing). */
    readonly unresolved: number;
    /** CFGs whose reaching-defs were not `computed` (no summary produced). */
    readonly gaps: number;
}
/**
 * Harvest per-function RETURN-VALUE ASCENT summaries (PDG FU-C, U-C2) for one
 * file's emit-safe CFGs — the dependence-engine SIBLING of
 * {@link harvestFileSummaries}. `cfgs` MUST already be `isEmitSafeCfg`-filtered.
 * Pure aside from the read-only graph lookup; never throws on valid input.
 *
 * Unlike the taint harvest, this needs NO source/sink model — return-value
 * ascent is purely data-dependence over the RD facts — so it runs for every
 * `--pdg` language (not just those with a registered taint spec). It reuses the
 * SAME per-function RD facts (recomputed via the same pure solver + cap the RD
 * emit used; the persisted REACHING_DEF projection is a lossy subset, so the
 * harvest re-derives in-phase exactly as the taint harvest does — no new
 * worker/CFG work, no parse-cache bump).
 */
export declare function harvestFileCallSummaries(fnIndex: FunctionNodeIndex, cfgs: readonly FunctionCfg[], maxFacts?: number, solve?: ReachingDefsSolver): FileCallSummaryResult;
