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
export const MAX_CFG_NESTING_DEPTH = 500;
/**
 * Thrown by the visitor nesting-depth guard ({@link CfgBuilder.enterNesting})
 * when lexical nesting exceeds {@link MAX_CFG_NESTING_DEPTH}. `collectFunctionCfgs`
 * catches it and counts the function under `skipped.tooDeeplyNested`, isolating
 * the bail to one function instead of risking a worker-wide stack overflow.
 */
export class CfgNestingDepthError extends Error {
    limit;
    constructor(limit) {
        super(`CFG nesting depth exceeded ${limit}`);
        this.limit = limit;
        this.name = 'CfgNestingDepthError';
    }
}
export class CfgBuilder {
    filePath;
    functionStartLine;
    functionEndLine;
    functionStartColumn;
    blocks = [];
    edges = [];
    edgeKeys = new Set();
    /** Live recursive-descent nesting depth — see {@link enterNesting}. */
    nesting = 0;
    entryIndex;
    exitIndex;
    constructor(filePath, functionStartLine, functionEndLine, 
    /** Start column of the owning function — disambiguates same-line functions
     *  in the BasicBlock ids (see {@link FunctionCfg.functionStartColumn}).
     *  Defaults to 0 for hand-built test CFGs that don't model columns. */
    functionStartColumn = 0) {
        this.filePath = filePath;
        this.functionStartLine = functionStartLine;
        this.functionEndLine = functionEndLine;
        this.functionStartColumn = functionStartColumn;
        this.entryIndex = this.newBlock(functionStartLine, functionStartLine, '', 'entry');
        this.exitIndex = this.newBlock(functionEndLine, functionEndLine, '', 'exit');
    }
    /** Create a block and return its index. */
    newBlock(startLine, endLine, text, kind = 'normal', facts) {
        this.blocks.push({
            startLine,
            endLine,
            textParts: text ? [text] : [],
            kind,
            statements: facts ? [facts] : [],
        });
        return this.blocks.length - 1;
    }
    /** Add a single edge (idempotent on from+to+kind). */
    edge(from, to, kind) {
        const key = `${from}->${to}:${kind}`;
        if (this.edgeKeys.has(key))
            return;
        this.edgeKeys.add(key);
        this.edges.push({ from, to, kind });
    }
    /** Wire a set of dangling exits to a single target block with one kind. */
    connect(exits, to, kind = 'seq') {
        for (const from of exits)
            this.edge(from, to, kind);
    }
    /** Extend a block's end line as more statements accrue to it. */
    extendBlock(index, endLine, appendText, facts) {
        const b = this.blocks[index];
        if (!b)
            return;
        if (endLine > b.endLine)
            b.endLine = endLine;
        if (appendText)
            b.textParts.push(appendText);
        if (facts)
            b.statements.push(facts);
    }
    /**
     * Attach a facts-only statement record to a block WITHOUT touching its text
     * or line span (#2082 M2 U1) — bench fingerprints and CFG snapshots include
     * block text, so harvesting must never perturb it (ENTRY-block param defs
     * are the canonical use; records that must precede a walked body get their
     * own facts-only block instead, see the catch-param handling in visitTry).
     */
    attachFacts(index, facts) {
        const b = this.blocks[index];
        if (!b)
            return;
        b.statements.push(facts);
    }
    get blockCount() {
        return this.blocks.length;
    }
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
    withNesting(fn) {
        this.enterNesting();
        try {
            return fn();
        }
        finally {
            this.exitNesting();
        }
    }
    /**
     * Increment the nesting counter, throwing {@link CfgNestingDepthError} past the
     * cap. Prefer {@link withNesting}, which pairs the exit in a `finally`; this is
     * exposed for direct depth-accounting tests only.
     */
    enterNesting() {
        if (++this.nesting > MAX_CFG_NESTING_DEPTH)
            throw new CfgNestingDepthError(MAX_CFG_NESTING_DEPTH);
    }
    /** Decrement the nesting counter — the partner of {@link enterNesting}. */
    exitNesting() {
        this.nesting--;
    }
    /** Produce the serializable CFG. Caller is responsible for having wired the
     *  function's dangling exits to {@link exitIndex} before calling.
     *
     *  Pass `bindings` (the function's binding table, possibly empty) to emit
     *  statement facts (#2082 M2 U1) — every block then carries a `statements`
     *  array. Omit it (hand-built test CFGs, pre-M2 producers) and both fields
     *  are absent, which the reaching-defs solver reports as `no-facts`. */
    finish(bindings) {
        const withFacts = bindings !== undefined;
        return {
            filePath: this.filePath,
            functionStartLine: this.functionStartLine,
            functionEndLine: this.functionEndLine,
            functionStartColumn: this.functionStartColumn,
            entryIndex: this.entryIndex,
            exitIndex: this.exitIndex,
            blocks: this.blocks.map((b, index) => ({
                index,
                startLine: b.startLine,
                endLine: b.endLine,
                text: b.textParts.join('\n'),
                kind: b.kind,
                ...(withFacts ? { statements: b.statements } : {}),
            })),
            edges: [...this.edges],
            ...(withFacts ? { bindings } : {}),
        };
    }
}
/**
 * Block indices reachable from `entryIndex` by following edges. Backs the
 * reachability property tests (R9) over hand-built and visitor-produced CFGs.
 */
export const reachableBlocks = (cfg) => {
    const adj = new Map();
    for (const e of cfg.edges) {
        const list = adj.get(e.from);
        if (list)
            list.push(e.to);
        else
            adj.set(e.from, [e.to]);
    }
    const seen = new Set([cfg.entryIndex]);
    const stack = [cfg.entryIndex];
    while (stack.length) {
        const n = stack.pop();
        for (const next of adj.get(n) ?? []) {
            if (!seen.has(next)) {
                seen.add(next);
                stack.push(next);
            }
        }
    }
    return seen;
};
