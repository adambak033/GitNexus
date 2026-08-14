import { CfgNestingDepthError } from './cfg-builder.js';
/**
 * Default per-function source-line cap used by the worker when the `--pdg` run
 * does not specify `pdgMaxFunctionLines`. A function longer than this (almost
 * always minified/generated code) is skipped rather than walked — its CFG is
 * both expensive and low-value. Overridable via `PipelineOptions.pdgMaxFunctionLines`.
 */
export const DEFAULT_PDG_MAX_FUNCTION_LINES = 2000;
/**
 * Convert a CFG built from an EXTRACTED sub-document's AST (script-relative
 * tree-sitter rows) into the enclosing file's coordinates by adding `offset` to
 * every source-line field. Needed for embedded scripts — a Vue SFC `<script>`
 * block parses at row 0 but lives at `lineOffset` in the `.vue` file, and every
 * other worker-emitted graph node is already file-relative; without this, the
 * CFG's `functionStartLine` would never join its Function/Method graph node
 * (inter-procedural taint silently resolves nothing) and BasicBlock source
 * lines would point at the wrong `.vue` line. A 0 offset returns the input
 * unchanged (the common case: `.ts`/`.js`/etc. parse at the file root), keeping
 * non-embedded languages byte-identical. Synthetic bindings keep `declLine` 0.
 */
function shiftCfgLines(cfg, offset) {
    if (offset === 0)
        return cfg;
    return {
        ...cfg,
        functionStartLine: cfg.functionStartLine + offset,
        functionEndLine: cfg.functionEndLine + offset,
        blocks: cfg.blocks.map((b) => ({
            ...b,
            startLine: b.startLine + offset,
            endLine: b.endLine + offset,
            statements: b.statements?.map((s) => ({ ...s, line: s.line + offset })),
        })),
        bindings: cfg.bindings?.map((bd) => bd.declLine > 0 ? { ...bd, declLine: bd.declLine + offset } : bd),
    };
}
export function collectFunctionCfgs(root, visitor, filePath, maxFunctionLines = 0, lineOffset = 0) {
    const cfgs = [];
    let tooManyLines = 0;
    let tooDeeplyNested = 0;
    let buildError = 0;
    const stack = [root];
    while (stack.length) {
        const node = stack.pop();
        if (visitor.isFunction(node)) {
            const lines = node.endPosition.row - node.startPosition.row + 1;
            if (maxFunctionLines > 0 && lines > maxFunctionLines) {
                tooManyLines++;
            }
            else {
                // Isolate the per-function build: a proactive deep-nesting bail
                // (CfgNestingDepthError) or any other visitor throw is counted and
                // skipped HERE, so it can't escape to the worker's language-group catch
                // and silently drop every remaining function's CFG (#2195).
                try {
                    const cfg = visitor.buildFunctionCfg(node, filePath);
                    if (cfg)
                        cfgs.push(shiftCfgLines(cfg, lineOffset));
                }
                catch (err) {
                    if (err instanceof CfgNestingDepthError)
                        tooDeeplyNested++;
                    else
                        buildError++;
                }
            }
        }
        // Descend regardless (a skipped mega-function may still contain small
        // nested functions that are worth a CFG of their own).
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i);
            if (child)
                stack.push(child);
        }
    }
    return { cfgs, skipped: { tooManyLines, tooDeeplyNested, buildError } };
}
