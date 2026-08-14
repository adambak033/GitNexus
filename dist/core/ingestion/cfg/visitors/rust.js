import { CfgBuilder } from '../cfg-builder.js';
import { ControlFlowContext, wireJumpThroughFinalizers } from '../control-flow-context.js';
import { RustHarvester } from './rust-harvest.js';
/** Rust node types that own a CFG-bearing function body. */
const RUST_FUNCTION_TYPES = new Set(['function_item', 'closure_expression']);
/**
 * Expression / statement node types that break a basic block (everything else
 * coalesces). `expression_statement` is the `<expr>;` wrapper; the control-flow
 * EXPRESSIONS inside it are unwrapped by {@link visitStmt}.
 */
const CONTROL_FLOW_TYPES = new Set([
    'expression_statement',
    'if_expression',
    'loop_expression',
    'while_expression',
    'for_expression',
    'match_expression',
    'return_expression',
    'break_expression',
    'continue_expression',
    'block',
]);
/** Expression node types that the statement walker treats as control-flow. */
const CONTROL_FLOW_EXPR_TYPES = new Set([
    'if_expression',
    'loop_expression',
    'while_expression',
    'for_expression',
    'match_expression',
    'return_expression',
    'break_expression',
    'continue_expression',
    'block',
]);
/** Node types whose subtrees are opaque (a nested function owns its own CFG). */
const NESTED_FUNCTION_TYPES = new Set(['function_item', 'closure_expression']);
/** Rust comment node types — line (`//`) and block (slash-star) comments. */
const COMMENT_TYPES = new Set(['line_comment', 'block_comment']);
const isNotComment = (n) => !COMMENT_TYPES.has(n.type);
const startLineOf = (n) => n.startPosition.row + 1;
const endLineOf = (n) => n.endPosition.row + 1;
/**
 * Per-function Rust walk state. One instance per function so the
 * {@link ControlFlowContext} and label tables are scoped to that function and
 * never leak across functions.
 */
class RustCfgWalk {
    builder;
    harvest;
    cfc = new ControlFlowContext();
    constructor(builder, harvest) {
        this.builder = builder;
        this.harvest = harvest;
    }
    /** Statements of a `block`, ignoring comments. */
    statementsOf(block) {
        return block.namedChildren.filter(isNotComment);
    }
    /** The `body` of a node (a `block`, or a bare expression for a closure / arm). */
    bodyOf(node) {
        return node.childForFieldName('body') ?? undefined;
    }
    /** Visit a body that may be a `block` or a single expression. */
    visitBody(node) {
        return this.builder.withNesting(() => {
            if (!node)
                return null;
            if (node.type === 'block')
                return this.visitSeq(this.statementsOf(node));
            return this.visitStmt(node);
        });
    }
    /** Wire a sequence of statements, coalescing straight-line runs into blocks. */
    visitSeq(stmts) {
        return this.builder.withNesting(() => {
            let entry;
            let dangling = [];
            let openSimple;
            for (const stmt of stmts) {
                if (this.isControlFlow(stmt)) {
                    openSimple = undefined; // close any open straight-line block
                    const res = this.visitStmt(stmt);
                    if (res === null)
                        continue; // transparent (empty nested block)
                    if (entry === undefined)
                        entry = res.entry;
                    else
                        this.builder.connect(dangling, res.entry, 'seq');
                    dangling = [...res.exits];
                }
                else {
                    const idx = openSimple === undefined ? this.openBlock(stmt) : this.extendOpen(openSimple, stmt);
                    if (openSimple === undefined) {
                        if (entry === undefined)
                            entry = idx;
                        else
                            this.builder.connect(dangling, idx, 'seq');
                        dangling = [idx];
                    }
                    openSimple = idx;
                    // A straight-line statement that contains a `?` early-returns to EXIT.
                    this.wireTryExits(stmt, idx);
                }
            }
            if (entry === undefined)
                return null;
            return { entry, exits: dangling };
        });
    }
    openBlock(stmt) {
        return this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
    }
    extendOpen(open, stmt) {
        this.builder.extendBlock(open, endLineOf(stmt), stmt.text, this.harvest.facts(stmt));
        return open;
    }
    /** Whether a statement node breaks the current straight-line block. */
    isControlFlow(stmt) {
        if (stmt.type === 'expression_statement') {
            const inner = this.exprStmtInner(stmt);
            return inner ? CONTROL_FLOW_EXPR_TYPES.has(inner.type) : false;
        }
        if (stmt.type === 'let_declaration') {
            // `let v = loop {…}` / `let w = if c {…} else {…}` / `let PAT = e else {…}`
            // — the value is a control-flow EXPRESSION, or the let-else alternative
            // block is divergent; either way the let must be modeled structurally.
            const value = stmt.childForFieldName('value');
            const alt = stmt.childForFieldName('alternative');
            return (value !== null && CONTROL_FLOW_EXPR_TYPES.has(value.type)) || alt !== null;
        }
        return CONTROL_FLOW_TYPES.has(stmt.type);
    }
    /** The inner expression of an `expression_statement` (`if x {…};`). */
    exprStmtInner(stmt) {
        return stmt.namedChildren.find(isNotComment);
    }
    /** Dispatch one statement to its handler. Non-null except for empty blocks. */
    visitStmt(stmt) {
        // Unwrap an `expression_statement` to its control-flow expression.
        if (stmt.type === 'expression_statement') {
            const inner = this.exprStmtInner(stmt);
            if (inner && CONTROL_FLOW_EXPR_TYPES.has(inner.type))
                return this.visitStmt(inner);
            return this.visitSimple(stmt);
        }
        if (stmt.type === 'let_declaration')
            return this.visitLet(stmt);
        switch (stmt.type) {
            case 'if_expression':
                return this.visitIf(stmt);
            case 'loop_expression':
                return this.visitLoop(stmt);
            case 'while_expression':
                return this.visitWhile(stmt);
            case 'for_expression':
                return this.visitFor(stmt);
            case 'match_expression':
                return this.visitMatch(stmt);
            case 'return_expression':
                return this.visitReturn(stmt);
            case 'break_expression':
                return this.visitBreak(stmt);
            case 'continue_expression':
                return this.visitContinue(stmt);
            case 'block':
                return this.visitSeq(this.statementsOf(stmt));
            default:
                return this.visitSimple(stmt);
        }
    }
    visitSimple(stmt) {
        const idx = this.openBlock(stmt);
        this.wireTryExits(stmt, idx);
        return { entry: idx, exits: [idx] };
    }
    /**
     * `let PAT = VALUE [else { ALT }]` whose VALUE is a control-flow expression
     * (`let v = loop {…}`, `let w = if c {…} else {…}`, `let m = match …`) or which
     * has a divergent let-else ALT block. A plain `let x = e;` never reaches here
     * (it coalesces into a straight-line block in {@link visitSeq}).
     *
     * The value's control-flow construct is visited as a sub-CFG; the let-pattern's
     * bindings are defs that happen on the value's NORMAL completion — attached to a
     * facts-only continuation block the value's exits feed. For a `let … else`, the
     * ALT block runs on the refutable-failure path and (per Rust's rules) MUST
     * diverge (return/break/continue/panic); it is visited as control flow, so its
     * own jumps wire directly to their targets and it contributes no normal exit.
     */
    visitLet(stmt) {
        const value = stmt.childForFieldName('value');
        const alt = stmt.childForFieldName('alternative');
        const cfValue = value !== null && CONTROL_FLOW_EXPR_TYPES.has(value.type);
        let entry;
        let normalExits;
        if (cfValue && value) {
            // `let v = loop {…}` — the value is a control-flow construct: visit it, then
            // attach ONLY the pattern's binding defs to a facts-only continuation (the
            // value's uses are already harvested onto its own blocks).
            const valueRes = this.visitStmt(value);
            const cont = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), '', 'normal', this.harvest.letPatternFacts(stmt));
            this.builder.connect(valueRes?.exits ?? [], cont, 'seq');
            entry = valueRes ? valueRes.entry : cont;
            normalExits = [cont];
        }
        else {
            // A simple-value `let PAT = e [else {…}]` — ONE block with the whole let's
            // facts (value uses + pattern defs). It reaches here only via the let-else
            // alternative (a plain `let x = e;` coalesces in visitSeq).
            const idx = this.openBlock(stmt);
            this.wireTryExits(stmt, idx);
            entry = idx;
            normalExits = [idx];
        }
        // `let … else { … }` — the else block runs on the binding-FAILURE path and
        // (per Rust) MUST diverge (return/break/continue/panic); visit it as control
        // flow so its jumps wire themselves to their targets. It is NOT on the normal
        // continuation — branched from the binding site with a `cond-false` (refute)
        // edge.
        if (alt) {
            const altRes = this.visitBody(alt);
            if (altRes)
                this.builder.connect(normalExits, altRes.entry, 'cond-false');
        }
        return { entry, exits: normalExits };
    }
    /**
     * Emit a `throw` (early-return) edge to EXIT for every `?` operator inside a
     * straight-line statement's subtree (excluding nested function bodies). The
     * `?` desugars to "return Err(...) early"; modeling it as a throw-like edge to
     * EXIT keeps the early-exit path represented while the Ok path falls through
     * normally. Deduped by the builder, so repeated `?` in a block emit one edge.
     */
    wireTryExits(stmt, fromBlock) {
        if (this.containsTry(stmt))
            this.builder.edge(fromBlock, this.builder.exitIndex, 'throw');
    }
    containsTry(node) {
        if (node.type === 'try_expression')
            return true;
        if (NESTED_FUNCTION_TYPES.has(node.type))
            return false; // opaque
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (c && this.containsTry(c))
                return true;
        }
        return false;
    }
    /** `return [expr]` — direct edge to the function EXIT. */
    visitReturn(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        // A `return f()?;` early-returns on the `?` path too.
        this.wireTryExits(stmt, idx);
        this.builder.edge(idx, this.builder.exitIndex, 'return');
        return { entry: idx, exits: [] };
    }
    /**
     * `break ['label] [value]` — targets the labeled loop frame if labeled, else the
     * nearest enclosing loop. `break value` is still a `break` edge (the value is a
     * normal use harvested onto the block).
     */
    visitBreak(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        this.wireTryExits(stmt, idx);
        const label = this.jumpLabel(stmt);
        const res = this.cfc.resolveBreak(label);
        const { target, finalizers } = res ?? {
            target: this.builder.exitIndex,
            finalizers: this.cfc.finalizersForReturn(),
        };
        wireJumpThroughFinalizers(this.builder, idx, finalizers, target, 'break');
        return { entry: idx, exits: [] };
    }
    /** `continue ['label]` — re-tests the labeled (or nearest) loop header. */
    visitContinue(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text);
        const label = this.jumpLabel(stmt);
        const res = this.cfc.resolveContinue(label);
        const { target, finalizers } = res ?? {
            target: this.builder.exitIndex,
            finalizers: this.cfc.finalizersForReturn(),
        };
        wireJumpThroughFinalizers(this.builder, idx, finalizers, target, 'continue');
        return { entry: idx, exits: [] };
    }
    /** The bare name (`outer`) of a `break`/`continue`'s `'label`, if any. */
    jumpLabel(stmt) {
        const label = stmt.namedChildren.find((c) => c.type === 'label');
        return this.labelName(label);
    }
    /** The bare identifier name of a `label` node (`'outer` ⇒ `outer`). */
    labelName(label) {
        if (!label)
            return undefined;
        const id = label.namedChildren.find((c) => c.type === 'identifier');
        return id?.text ?? label.text.replace(/^'/, '');
    }
    /**
     * The optional `'label` of a loop expression (a NAMED CHILD, not a field — Rust
     * attaches the label directly to the loop, unlike Go's `labeled_statement`).
     */
    loopLabels(stmt) {
        const label = stmt.namedChildren.find((c) => c.type === 'label');
        const name = this.labelName(label);
        return name !== undefined ? [name] : [];
    }
    /**
     * `if COND { … } [else { … } | else if …]`. The condition can be a plain
     * expression, a `let_condition` (`if let PAT = e`), or a `let_chain`. The header
     * carries the condition's def/use facts (an `if let` pattern is a def, its value
     * a use). The else `alternative` is an `else_clause` wrapping a `block` or a
     * nested `if_expression` (the `else if` chain).
     */
    visitIf(stmt) {
        const cond = stmt.childForFieldName('condition') ?? stmt;
        const header = this.builder.newBlock(startLineOf(stmt), endLineOf(cond), cond.text, 'normal', this.condFacts(cond, false));
        this.wireTryExits(cond, header);
        const exits = [];
        const thenRes = this.visitBody(stmt.childForFieldName('consequence'));
        if (thenRes) {
            this.builder.edge(header, thenRes.entry, 'cond-true');
            exits.push(...thenRes.exits);
        }
        else {
            exits.push(header); // empty then — true path falls through
        }
        const elseNode = this.elseBodyOf(stmt);
        if (elseNode) {
            const elseRes = this.visitBody(elseNode);
            if (elseRes) {
                this.builder.edge(header, elseRes.entry, 'cond-false');
                exits.push(...elseRes.exits);
            }
            else {
                exits.push(header);
            }
        }
        else {
            exits.push(header); // no else — false path falls through to the join
        }
        return { entry: header, exits: [...new Set(exits)] };
    }
    /** The else body of an `if_expression` (unwraps the `else_clause` wrapper). */
    elseBodyOf(stmt) {
        const alt = stmt.childForFieldName('alternative');
        if (!alt)
            return undefined;
        if (alt.type === 'else_clause') {
            // The clause wraps a `block` or a nested `if_expression` (`else if`).
            return alt.namedChildren.find(isNotComment);
        }
        return alt;
    }
    /**
     * `loop { … }` — Rust's INFINITE loop (NO condition). Body exits re-enter the
     * header (`loop-back`); a `break` reaches `loopExit`. We ALWAYS emit a
     * structural `header → loopExit` `cond-false` escape edge so EXIT stays
     * reverse-reachable (a `loop {}` with no break never reaches EXIT otherwise, and
     * the CDG pass would be silently skipped for the whole function).
     */
    visitLoop(stmt) {
        const labels = this.loopLabels(stmt);
        const header = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), 'loop');
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, labels);
        const body = this.visitBody(this.bodyOf(stmt));
        this.cfc.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, header, 'loop-back');
        }
        else {
            this.builder.edge(header, header, 'loop-back'); // empty `loop {}` re-enters
        }
        // Structural escape edge — keeps EXIT reverse-reachable even for `loop {}`
        // with no `break` (the canonical Rust non-terminating case).
        this.builder.edge(header, loopExit, 'cond-false');
        return { entry: header, exits: [loopExit] };
    }
    /**
     * `while COND { … }` (and `while let PAT = e { … }`). Standard loop: header
     * tests, true → body → loop-back, false → loop exit. The `while let` pattern is
     * a may-def on the header (the binding does not happen on the exit iteration).
     */
    visitWhile(stmt) {
        const labels = this.loopLabels(stmt);
        const cond = stmt.childForFieldName('condition') ?? stmt;
        const header = this.builder.newBlock(startLineOf(stmt), endLineOf(cond), cond.text, 'normal', this.condFacts(cond, true));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, labels);
        const body = this.visitBody(this.bodyOf(stmt));
        this.cfc.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, header, 'loop-back');
        }
        else {
            this.builder.edge(header, header, 'loop-back'); // empty body re-tests
        }
        // Structural exit edge — even `while true {}` keeps EXIT reverse-reachable.
        this.builder.edge(header, loopExit, 'cond-false');
        return { entry: header, exits: [loopExit] };
    }
    /**
     * `for PAT in ITER { … }`. The header binds the loop pattern (a def) and uses
     * the iterated expression. Standard loop topology.
     */
    visitFor(stmt) {
        const labels = this.loopLabels(stmt);
        const value = stmt.childForFieldName('value');
        const headEnd = value ? endLineOf(value) : startLineOf(stmt);
        const header = this.builder.newBlock(startLineOf(stmt), headEnd, this.forHeaderText(stmt), 'normal', this.harvest.forHeadFacts(stmt));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, labels);
        const body = this.visitBody(this.bodyOf(stmt));
        this.cfc.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, header, 'loop-back');
        }
        else {
            this.builder.edge(header, header, 'loop-back'); // empty body re-iterates
        }
        this.builder.edge(header, loopExit, 'cond-false');
        return { entry: header, exits: [loopExit] };
    }
    forHeaderText(stmt) {
        const pat = stmt.childForFieldName('pattern')?.text ?? '';
        const value = stmt.childForFieldName('value')?.text ?? '';
        return pat || value ? `for ${pat} in ${value}` : 'for';
    }
    /**
     * `match VALUE { PAT [if guard] => ARM, … }`. Arms do NOT fall through (like
     * Go / Python). Each arm body is dispatched from the subject block with a
     * `switch-case` edge; arm bodies rejoin AFTER the match. A `match` with no
     * irrefutable `_` arm also reaches the join directly (no-match path), keeping
     * EXIT reverse-reachable.
     */
    visitMatch(stmt) {
        const value = stmt.childForFieldName('value');
        const dispatch = this.builder.newBlock(startLineOf(stmt), value ? endLineOf(value) : startLineOf(stmt), value ? `match ${value.text}` : 'match', 'normal', value ? this.harvest.facts(value) : undefined);
        if (value)
            this.wireTryExits(value, dispatch);
        const matchExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        const body = stmt.childForFieldName('body') ?? stmt.namedChildren.find((c) => c.type === 'match_block');
        const arms = body ? body.namedChildren.filter((c) => c.type === 'match_arm') : [];
        // Each arm's pattern bindings (`Some(n) =>`) are MAY-defs from the matched
        // subject, and a guarded arm (`PAT if g`) evaluates `g` conditionally — both
        // are harvested onto the dispatch block (co-located with the subject's use, so
        // a tainted subject reaches the binding), as may-defs (a later arm binds/tests
        // only when earlier ones didn't match). #2206.
        for (const arm of arms) {
            const patFacts = this.harvest.matchArmPatternFacts(arm);
            if (patFacts)
                this.builder.attachFacts(dispatch, patFacts);
            const guard = this.armGuard(arm);
            if (guard)
                this.builder.attachFacts(dispatch, this.harvest.factsConditional(guard));
        }
        this.cfc.pushSwitch(matchExit, []);
        let hasIrrefutable = false;
        for (const arm of arms) {
            // The arm body may be an expr or block; its pattern bindings were harvested
            // onto the dispatch above (#2206).
            const armBody = this.visitBody(arm.childForFieldName('value'));
            const entry = armBody?.entry ?? matchExit;
            this.builder.edge(dispatch, entry, 'switch-case');
            if (armBody)
                this.builder.connect(armBody.exits, matchExit, 'seq');
            if (this.isIrrefutableArm(arm))
                hasIrrefutable = true;
        }
        this.cfc.pop();
        // No catch-all arm → a no-match path reaches the exit directly. (A real Rust
        // match is exhaustive, but a non-`_`-tailed match keeps EXIT reverse-reachable
        // even when every arm body jumps.)
        if (!hasIrrefutable)
            this.builder.edge(dispatch, matchExit, 'switch-case');
        return { entry: dispatch, exits: [matchExit] };
    }
    /** The guard condition of a `match_arm` (`PAT if g`), if any. */
    armGuard(arm) {
        const pat = arm.childForFieldName('pattern');
        return pat?.childForFieldName('condition') ?? undefined;
    }
    /** A `_ =>` arm with no guard is the unconditional catch-all. */
    isIrrefutableArm(arm) {
        if (this.armGuard(arm))
            return false;
        const pat = arm.childForFieldName('pattern');
        return pat?.text.trim() === '_';
    }
    /**
     * Def/use facts for an `if`/`while` condition. A `let_condition` binds a pattern
     * (a def — a may-def for `while let`, which re-tests) and uses its value; a
     * `let_chain` threads through each `let_condition`. A plain expression is walked
     * for uses.
     */
    condFacts(cond, loopCond) {
        if (cond.type === 'let_condition') {
            return this.harvest.letConditionFacts(cond, loopCond);
        }
        // A `let_chain` (`let PAT = e && cond`) — harvest the whole chain. The let
        // bindings inside it are defs (may-defs for a while-let chain).
        return this.harvest.facts(cond);
    }
}
/** Build the CFG for one Rust function / closure node, or `undefined`. */
function buildFunctionCfg(fnNode, filePath) {
    try {
        if (!RUST_FUNCTION_TYPES.has(fnNode.type))
            return undefined;
        const startLine = startLineOf(fnNode);
        const endLine = endLineOf(fnNode);
        const startColumn = fnNode.startPosition.column;
        const body = fnNode.childForFieldName('body');
        if (!body)
            return undefined; // trait method signature / no body
        const builder = new CfgBuilder(filePath, startLine, endLine, startColumn);
        const harvest = new RustHarvester(fnNode);
        const paramFacts = harvest.paramFacts();
        if (paramFacts)
            builder.attachFacts(builder.entryIndex, paramFacts);
        const walk = new RustCfgWalk(builder, harvest);
        if (body.type !== 'block') {
            // A closure with an expression body (`|x| x + 1`): one block whose value is
            // the returned expression. A `?` inside it early-returns to EXIT.
            const res = walk.visitStmt(body);
            builder.edge(builder.entryIndex, res ? res.entry : builder.exitIndex, 'seq');
            builder.connect(res ? res.exits : [builder.entryIndex], builder.exitIndex, 'seq');
            return builder.finish(harvest.bindingTable());
        }
        const res = walk.visitSeq(body.namedChildren.filter(isNotComment));
        if (!res) {
            builder.edge(builder.entryIndex, builder.exitIndex, 'seq'); // empty body
            return builder.finish(harvest.bindingTable());
        }
        builder.edge(builder.entryIndex, res.entry, 'seq');
        builder.connect(res.exits, builder.exitIndex, 'seq'); // normal fall-off → EXIT
        return builder.finish(harvest.bindingTable());
    }
    catch (err) {
        // Never throw out of buildFunctionCfg — a malformed AST shape must skip only
        // this one function's CFG, never drop the whole file's language group (R4).
        // eslint-disable-next-line no-console
        console.warn(`[cfg] Rust buildFunctionCfg skipped a function in ${filePath}: ${String(err)}`);
        return undefined;
    }
}
/** Whether a node is a Rust function/closure this visitor builds a CFG for. */
function isFunction(node) {
    return RUST_FUNCTION_TYPES.has(node.type);
}
/** The Rust CFG visitor. */
export function createRustCfgVisitor() {
    return { buildFunctionCfg, isFunction };
}
export { RUST_FUNCTION_TYPES };
