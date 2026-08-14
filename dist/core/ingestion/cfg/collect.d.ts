/**
 * collectFunctionCfgs (issue #2081, M1).
 *
 * Walks a parsed file's tree-sitter tree and builds one {@link FunctionCfg} per
 * CFG-bearing function via the language's {@link CfgVisitor}. Runs IN THE PARSE
 * WORKER (where the AST lives — KTD1/KTD7); the result rides on
 * `ParsedFile.cfgSideChannel` across the worker→main boundary.
 *
 * Nested functions are enumerated independently — each gets its own CFG, and
 * appears as an opaque straight-line block in its enclosing function's CFG (the
 * visitor does not descend into nested function bodies). `maxFunctionLines`
 * bounds per-function cost: a function whose source span exceeds the cap is
 * skipped (and counted) rather than walked, so a pathological mega-function
 * cannot blow up worker time/memory. A cap of `0` means no limit.
 */
import type { SyntaxNode } from '../utils/ast-helpers.js';
import type { CfgVisitor, FunctionCfg } from './types.js';
/**
 * Default per-function source-line cap used by the worker when the `--pdg` run
 * does not specify `pdgMaxFunctionLines`. A function longer than this (almost
 * always minified/generated code) is skipped rather than walked — its CFG is
 * both expensive and low-value. Overridable via `PipelineOptions.pdgMaxFunctionLines`.
 */
export declare const DEFAULT_PDG_MAX_FUNCTION_LINES = 2000;
/**
 * CFG-bearing functions skipped during the walk, bucketed by reason (#2195).
 * Surfaced per-language in the parse telemetry (parsing-processor.ts) so a CFG
 * coverage gap is observable, not silent. All-zero ⇒ nothing skipped.
 */
export interface CfgSkipCounts {
    /** Source span exceeded `maxFunctionLines` (minified / generated code). */
    readonly tooManyLines: number;
    /**
     * Recursive-descent nesting hit {@link MAX_CFG_NESTING_DEPTH} — a proactive,
     * deterministic bail (see {@link CfgNestingDepthError}) before a worker stack
     * overflow.
     */
    readonly tooDeeplyNested: number;
    /**
     * `buildFunctionCfg` threw an unexpected error. Caught PER FUNCTION so one
     * malformed function no longer drops the whole file's CFGs (the throw used to
     * escape to the worker's language-group catch).
     */
    readonly buildError: number;
}
export interface CollectedCfgs {
    readonly cfgs: readonly FunctionCfg[];
    /** Per-reason skip counts (#2195). */
    readonly skipped: CfgSkipCounts;
}
export declare function collectFunctionCfgs(root: SyntaxNode, visitor: CfgVisitor<SyntaxNode>, filePath: string, maxFunctionLines?: number, lineOffset?: number): CollectedCfgs;
