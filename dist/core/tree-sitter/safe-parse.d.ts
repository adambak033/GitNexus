import type Parser from 'tree-sitter';
/**
 * Thrown when a parse exceeds its wall-clock budget (see
 * {@link DEFAULT_PARSE_TIMEOUT_MS}). The parser has already been `reset()` and
 * its budget cleared by the time this propagates, so callers may safely reuse
 * the same parser for the next file.
 *
 * Hard-skip contract: a timeout is fatal for the offending file but MUST NOT
 * abort the run. Every caller is responsible for catching this specific error
 * (`instanceof ParseTimeoutError`), skipping that one file (degrade-and-
 * continue), and re-throwing anything else. Catching it generically and
 * swallowing all errors would mask real bugs, so callers match on the type.
 */
export declare class ParseTimeoutError extends Error {
    readonly budgetMs: number;
    readonly label?: string;
    constructor(budgetMs: number, label?: string);
}
/**
 * Reset the per-run degraded-parse log throttle. Called at the start of every
 * analysis run (`runFullAnalysis`) so the first-N-then-suppress budget is
 * scoped to a single run rather than to the lifetime of the module (which, on
 * a reused process, would suppress all degraded-parse logs after the first
 * run). Safe to call at any time.
 */
export declare function resetDegradedParseCounter(): void;
/**
 * True when the parsed tree contains any ERROR or MISSING node — i.e. the
 * source did not parse cleanly and tree-sitter applied error recovery.
 * `parse` never throws on bad syntax (it recovers into ERROR/MISSING nodes),
 * so this is the only signal callers have that a tree is degraded.
 */
export declare function parseHadErrors(tree: Parser.Tree): boolean;
/**
 * Structured diagnostics for a parsed tree. Cheap (reads boolean node
 * properties only); callers that just want a yes/no use {@link parseHadErrors}.
 */
export declare function getParseDiagnostics(tree: Parser.Tree): {
    hasError: boolean;
    isMissing: boolean;
};
/**
 * Parse `sourceText` safely on every platform.
 *
 * This is the single "parse safely" entry point and its contract covers four
 * concerns:
 *
 *  1. **Windows crash workaround.** Inputs longer than 32 767 chars are fed
 *     through the chunked `Parser.Input` callback overload to dodge the
 *     0.21.x string-to-buffer SIGSEGV. See {@link SAFE_PARSE_CHUNK_CHARS}.
 *
 *  2. **Runaway-parse timeout.** A per-parse budget (default 15 s, env
 *     `GITNEXUS_PARSE_TIMEOUT_MS`, `0` disables) is armed before parsing on
 *     both the direct and chunked paths. On timeout the runtime returns
 *     `null`; this function `reset()`s the parser, clears the budget, and
 *     throws {@link ParseTimeoutError}. The budget is always cleared in a
 *     `finally` so it never leaks to the next parse on a reused/singleton
 *     parser (`loadParser()` and the worker both reuse one `Parser`).
 *
 *  3. **Intrinsic error detection.** On a successful parse, a degraded tree
 *     (`rootNode.hasError`) is logged at `debug` level with throttling, then
 *     the tree is **returned anyway** — error recovery is a downgrade, never a
 *     drop. Callers wanting the boolean use {@link parseHadErrors}.
 *
 *  4. **Embedded NUL recovery.** U+0000 is replaced with one ASCII space in
 *     the parser-only input. The one-for-one substitution keeps tree indices
 *     aligned with the original source while preventing language lexers from
 *     swallowing declarations during error recovery.
 *
 * @param label optional context (e.g. file path) attached to timeout errors,
 *   recovery warnings, and degraded-parse logs. Non-breaking trailing param.
 */
export declare function parseSourceSafe(parser: Parser, sourceText: string, oldTree?: Parser.Tree, options?: Parser.Options, label?: string): Parser.Tree;
