/**
 * CfgBuilder (issue #2081, M1) — the language-agnostic accumulator.
 *
 * A per-language `CfgVisitor` drives this: it creates blocks as it walks
 * statements, wires edges (including back-edges and break/continue/return/throw
 * targets resolved via {@link ControlFlowContext}), and calls {@link finish} to
 * produce the serializable {@link FunctionCfg}. The builder owns the synthetic
 * ENTRY (index 0) and EXIT blocks and de-duplicates identical edges so repeated
 * `connect` calls (common when wiring a set of dangling exits) stay idempotent.
 *
 * It has no knowledge of any AST — it is exercised directly in unit tests with
 * hand-built block sequences, which is how the classic CFG hazards are pinned
 * before the tree-sitter visitor (U2) drives it.
 */
import type { BasicBlockData, BindingEntry, CfgEdgeKind, FunctionCfg, StatementFacts } from './types.js';
/**
 * Hard ceiling on CFG recursive-descent scope-entry depth (#2195). A language
 * `CfgVisitor` wraps each nested block scope in {@link CfgBuilder.withNesting} (its
 * `visitBody` / `visitSeq` choke points), so the live count tracks scope entries,
 * not statement width. NOTE the count is ~2× LEXICAL nesting for block-bodied
 * constructs (visitBody → visitSeq both enter), so the effective lexical ceiling
 * is ~250 levels for block bodies (~500 for single-statement bodies / bare
 * blocks). Real source nests ≤ ~50 deep, so this fires only on machine-generated
 * / adversarial input. Both effective ceilings sit far below the engine's native
 * stack limit (~1.2k+ nesting even on the raised worker `stackSizeMb`), so the
 * bail is a DETERMINISTIC, language-independent {@link CfgNestingDepthError}
 * rather than a nondeterministic `RangeError` thrown somewhere mid-walk.
 */
export declare const MAX_CFG_NESTING_DEPTH = 500;
/**
 * Thrown by the visitor nesting-depth guard ({@link CfgBuilder.enterNesting})
 * when lexical nesting exceeds {@link MAX_CFG_NESTING_DEPTH}. `collectFunctionCfgs`
 * catches it and counts the function under `skipped.tooDeeplyNested`, isolating
 * the bail to one function instead of risking a worker-wide stack overflow.
 */
export declare class CfgNestingDepthError extends Error {
    readonly limit: number;
    constructor(limit: number);
}
export declare class CfgBuilder {
    private readonly filePath;
    private readonly functionStartLine;
    private readonly functionEndLine;
    /** Start column of the owning function — disambiguates same-line functions
     *  in the BasicBlock ids (see {@link FunctionCfg.functionStartColumn}).
     *  Defaults to 0 for hand-built test CFGs that don't model columns. */
    private readonly functionStartColumn;
    private readonly blocks;
    private readonly edges;
    private readonly edgeKeys;
    /** Live recursive-descent nesting depth — see {@link enterNesting}. */
    private nesting;
    readonly entryIndex: number;
    readonly exitIndex: number;
    constructor(filePath: string, functionStartLine: number, functionEndLine: number, 
    /** Start column of the owning function — disambiguates same-line functions
     *  in the BasicBlock ids (see {@link FunctionCfg.functionStartColumn}).
     *  Defaults to 0 for hand-built test CFGs that don't model columns. */
    functionStartColumn?: number);
    /** Create a block and return its index. */
    newBlock(startLine: number, endLine: number, text: string, kind?: BasicBlockData['kind'], facts?: StatementFacts): number;
    /** Add a single edge (idempotent on from+to+kind). */
    edge(from: number, to: number, kind: CfgEdgeKind): void;
    /** Wire a set of dangling exits to a single target block with one kind. */
    connect(exits: readonly number[], to: number, kind?: CfgEdgeKind): void;
    /** Extend a block's end line as more statements accrue to it. */
    extendBlock(index: number, endLine: number, appendText?: string, facts?: StatementFacts): void;
    /**
     * Attach a facts-only statement record to a block WITHOUT touching its text
     * or line span (#2082 M2 U1) — bench fingerprints and CFG snapshots include
     * block text, so harvesting must never perturb it (ENTRY-block param defs
     * are the canonical use; records that must precede a walked body get their
     * own facts-only block instead, see the catch-param handling in visitTry).
     */
    attachFacts(index: number, facts: StatementFacts): void;
    get blockCount(): number;
    /**
     * Run `fn` inside ONE nested block scope (#2195) — the single choke every
     * visitor's `visitBody` / `visitSeq` funnels through. Enters on the way in and
     * exits in a `finally`, so the live depth is balanced on every return AND every
     * throw and the enter/exit can never drift out of pair (the reason this is one
     * helper, not 24 hand-paired call sites). Throws {@link CfgNestingDepthError}
     * when nesting exceeds {@link MAX_CFG_NESTING_DEPTH} — a proactive, deterministic
     * bail before the native stack can overflow on a pathologically nested function.
     *
     * A block-bodied construct passes through BOTH visitBody and visitSeq, so it
     * costs TWO scopes per lexical level: the effective structural ceiling is
     * ~MAX_CFG_NESTING_DEPTH/2 (~250) lexical levels for block bodies (~500 for
     * single-statement bodies / bare blocks, which hit only one of the two). Still
     * an order of magnitude below the native limit and far above real code (≤ ~50).
     */
    withNesting<T>(fn: () => T): T;
    /**
     * Increment the nesting counter, throwing {@link CfgNestingDepthError} past the
     * cap. Prefer {@link withNesting}, which pairs the exit in a `finally`; this is
     * exposed for direct depth-accounting tests only.
     */
    enterNesting(): void;
    /** Decrement the nesting counter — the partner of {@link enterNesting}. */
    exitNesting(): void;
    /** Produce the serializable CFG. Caller is responsible for having wired the
     *  function's dangling exits to {@link exitIndex} before calling.
     *
     *  Pass `bindings` (the function's binding table, possibly empty) to emit
     *  statement facts (#2082 M2 U1) — every block then carries a `statements`
     *  array. Omit it (hand-built test CFGs, pre-M2 producers) and both fields
     *  are absent, which the reaching-defs solver reports as `no-facts`. */
    finish(bindings?: readonly BindingEntry[]): FunctionCfg;
}
/**
 * Block indices reachable from `entryIndex` by following edges. Backs the
 * reachability property tests (R9) over hand-built and visitor-produced CFGs.
 */
export declare const reachableBlocks: (cfg: FunctionCfg) => Set<number>;
