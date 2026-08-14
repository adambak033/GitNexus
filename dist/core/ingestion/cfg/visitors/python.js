import { CfgBuilder } from '../cfg-builder.js';
import { ControlFlowContext, drainFinalizerPending, wireJumpThroughFinalizers, } from '../control-flow-context.js';
import { PythonHarvester } from './python-harvest.js';
/** Python node types that own a CFG-bearing function body. */
const PY_FUNCTION_TYPES = new Set(['function_definition', 'lambda']);
/** Statement node types that break a basic block (everything else coalesces). */
const CONTROL_FLOW_TYPES = new Set([
    'if_statement',
    'for_statement',
    'while_statement',
    'with_statement',
    'try_statement',
    'match_statement',
    'return_statement',
    'raise_statement',
    'break_statement',
    'continue_statement',
    'block',
]);
const startLineOf = (n) => n.startPosition.row + 1;
const endLineOf = (n) => n.endPosition.row + 1;
/**
 * Per-function Python walk state. One instance per function so the
 * {@link ControlFlowContext}, the exception-handler stack, and the `with` /
 * `finally` finalizer chain are scoped to that function and never leak across
 * functions.
 */
class PythonCfgWalk {
    builder;
    harvest;
    cfc = new ControlFlowContext();
    /** Stack of exception-handler entry blocks (except/finally/with-dispose) a `raise` jumps to. */
    handlers = [];
    constructor(builder, harvest) {
        this.builder = builder;
        this.harvest = harvest;
    }
    /** Statements of a block node, ignoring comments. */
    statementsOf(block) {
        return block.namedChildren.filter((c) => c.type !== 'comment');
    }
    /** The `body` block of a node (field, or the first `block` child). */
    bodyBlockOf(node) {
        return node.childForFieldName('body') ?? node.namedChildren.find((c) => c.type === 'block');
    }
    /** Visit a body that may be a `block` or a single statement. */
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
                if (CONTROL_FLOW_TYPES.has(stmt.type)) {
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
                    if (openSimple === undefined) {
                        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
                        if (entry === undefined)
                            entry = idx;
                        else
                            this.builder.connect(dangling, idx, 'seq');
                        openSimple = idx;
                        dangling = [idx];
                    }
                    else {
                        this.builder.extendBlock(openSimple, endLineOf(stmt), stmt.text, this.harvest.facts(stmt));
                    }
                }
            }
            if (entry === undefined)
                return null;
            return { entry, exits: dangling };
        });
    }
    /** Dispatch one statement to its handler. Non-null except for empty blocks. */
    visitStmt(stmt) {
        switch (stmt.type) {
            case 'if_statement':
                return this.visitIf(stmt);
            case 'for_statement':
                return this.visitFor(stmt);
            case 'while_statement':
                return this.visitWhile(stmt);
            case 'with_statement':
                return this.visitWith(stmt);
            case 'try_statement':
                return this.visitTry(stmt);
            case 'match_statement':
                return this.visitMatch(stmt);
            case 'return_statement':
                return this.visitReturn(stmt);
            case 'raise_statement':
                return this.visitRaise(stmt);
            case 'break_statement':
                return this.visitBreak(stmt);
            case 'continue_statement':
                return this.visitContinue(stmt);
            case 'block':
                return this.visitSeq(this.statementsOf(stmt));
            default:
                return this.visitSimple(stmt);
        }
    }
    visitSimple(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        return { entry: idx, exits: [idx] };
    }
    /** `return [expr]` — threads through EVERY active `with`/`finally` before EXIT. */
    visitReturn(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        wireJumpThroughFinalizers(this.builder, idx, this.cfc.finalizersForReturn(), this.builder.exitIndex, 'return');
        return { entry: idx, exits: [] };
    }
    /** `raise [expr]` — jumps to the nearest handler (except / with-dispose / EXIT). */
    visitRaise(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        this.builder.edge(idx, this.currentHandler(), 'throw');
        return { entry: idx, exits: [] };
    }
    visitBreak(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text);
        const res = this.cfc.resolveBreak();
        const { target, finalizers } = res ?? {
            target: this.builder.exitIndex,
            finalizers: this.cfc.finalizersForReturn(),
        };
        wireJumpThroughFinalizers(this.builder, idx, finalizers, target, 'break');
        return { entry: idx, exits: [] };
    }
    visitContinue(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text);
        const res = this.cfc.resolveContinue();
        const { target, finalizers } = res ?? {
            target: this.builder.exitIndex,
            finalizers: this.cfc.finalizersForReturn(),
        };
        wireJumpThroughFinalizers(this.builder, idx, finalizers, target, 'continue');
        return { entry: idx, exits: [] };
    }
    /**
     * `if cond: … elif cond: … else: …`. Python has NO nested-if else chain: an
     * `if_statement` carries the condition + consequence plus zero-or-more
     * `alternative` fields, each an `elif_clause` (its own condition + consequence)
     * or a single trailing `else_clause`. The elif chain is threaded on the
     * `cond-false` edge.
     */
    visitIf(stmt) {
        const cond = stmt.childForFieldName('condition') ?? stmt;
        const header = this.builder.newBlock(startLineOf(stmt), endLineOf(cond), cond.text, 'normal', this.harvest.facts(cond));
        const exits = [];
        const thenRes = this.visitBody(stmt.childForFieldName('consequence'));
        if (thenRes) {
            this.builder.edge(header, thenRes.entry, 'cond-true');
            exits.push(...thenRes.exits);
        }
        else {
            exits.push(header); // empty then — true path falls through
        }
        // The alternatives, in source order: elif_clause* then optional else_clause.
        const alternatives = this.alternativesOf(stmt);
        let falseFrom = header; // block whose cond-false edge feeds the next alternative
        for (const alt of alternatives) {
            if (alt.type === 'elif_clause') {
                const elifCond = alt.childForFieldName('condition') ?? alt;
                const elifHeader = this.builder.newBlock(startLineOf(alt), endLineOf(elifCond), elifCond.text, 'normal', this.harvest.facts(elifCond));
                this.builder.edge(falseFrom, elifHeader, 'cond-false');
                const elifRes = this.visitBody(alt.childForFieldName('consequence'));
                if (elifRes) {
                    this.builder.edge(elifHeader, elifRes.entry, 'cond-true');
                    exits.push(...elifRes.exits);
                }
                else {
                    exits.push(elifHeader);
                }
                falseFrom = elifHeader;
            }
            else if (alt.type === 'else_clause') {
                const elseRes = this.visitBody(alt.childForFieldName('body'));
                if (elseRes) {
                    this.builder.edge(falseFrom, elseRes.entry, 'cond-false');
                    exits.push(...elseRes.exits);
                }
                else {
                    exits.push(falseFrom);
                }
                falseFrom = -1; // an else consumes the false path entirely
            }
        }
        // No trailing else: the last header's cond-false falls through to the join.
        if (falseFrom >= 0)
            exits.push(falseFrom);
        return { entry: header, exits: [...new Set(exits)] };
    }
    /** The `alternative`-field children of an `if_statement`, in source order. */
    alternativesOf(stmt) {
        const out = [];
        for (let i = 0; i < stmt.childCount; i++) {
            if (stmt.fieldNameForChild(i) === 'alternative') {
                const c = stmt.child(i);
                if (c)
                    out.push(c);
            }
        }
        return out;
    }
    /**
     * `for TARGET in ITER: … [else: …]`. Header = the iteration test (a use of the
     * iterable + a def of the target). The loop `else` runs on NORMAL completion
     * (the cond-false path) — a `break` targets the loop exit AFTER the else, so it
     * skips the else.
     */
    visitFor(stmt) {
        const left = stmt.childForFieldName('left');
        const right = stmt.childForFieldName('right');
        const headEnd = right ? endLineOf(right) : startLineOf(stmt);
        const header = this.builder.newBlock(startLineOf(stmt), headEnd, this.loopHeaderText(stmt, left, right), 'normal', this.harvest.loopHeadFacts(stmt));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, []);
        const body = this.visitBody(this.bodyBlockOf(stmt));
        this.cfc.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, header, 'loop-back');
        }
        else {
            this.builder.edge(header, header, 'loop-back'); // empty body re-tests
        }
        this.wireLoopElse(stmt, header, loopExit);
        return { entry: header, exits: [loopExit] };
    }
    /** `while cond: … [else: …]`. Same `else`-on-normal-completion semantics as `for`. */
    visitWhile(stmt) {
        const cond = stmt.childForFieldName('condition') ?? stmt;
        const header = this.builder.newBlock(startLineOf(stmt), endLineOf(cond), cond.text, 'normal', this.harvest.facts(cond));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, []);
        const body = this.visitBody(this.bodyBlockOf(stmt));
        this.cfc.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, header, 'loop-back');
        }
        else {
            this.builder.edge(header, header, 'loop-back'); // empty `while c: pass` re-tests
        }
        this.wireLoopElse(stmt, header, loopExit);
        return { entry: header, exits: [loopExit] };
    }
    /**
     * Wire the optional loop `else` clause. The else runs once on normal completion
     * (the header's `cond-false` edge). With an else, the cond-false edge goes
     * `header → elseEntry` and the else's exits reach `loopExit`; without one, the
     * structural `header → loopExit` `cond-false` edge keeps EXIT reverse-reachable
     * (critical for `while True:` — and matches the C-family visitors). A `break`
     * always targets `loopExit` directly, so it never runs the else.
     */
    wireLoopElse(stmt, header, loopExit) {
        const elseClause = this.loopElseOf(stmt);
        if (elseClause) {
            const elseRes = this.visitBody(elseClause.childForFieldName('body'));
            if (elseRes) {
                this.builder.edge(header, elseRes.entry, 'cond-false');
                this.builder.connect(elseRes.exits, loopExit, 'seq');
                return;
            }
        }
        // No (or empty) else — normal completion falls straight to the loop exit.
        this.builder.edge(header, loopExit, 'cond-false');
    }
    /** The `else_clause` of a `for`/`while` (its `alternative` field), if any. */
    loopElseOf(stmt) {
        const alt = stmt.childForFieldName('alternative');
        return alt?.type === 'else_clause' ? alt : undefined;
    }
    loopHeaderText(stmt, left, right) {
        const l = left?.text ?? '';
        const r = right?.text ?? '';
        return l || r ? `for ${l} in ${r}` : stmt.text.split('\n')[0];
    }
    /**
     * `with EXPR [as t], …: BODY`. The context managers' `__exit__` runs
     * deterministically on BOTH the normal exit and an exception — modeled exactly
     * like `try/finally`: a finalizer frame holding the dispose block, plus a
     * `throw` edge from every protected-body block to the dispose. A
     * `return`/`break`/`continue` inside the body threads through the dispose. The
     * dispose re-propagates on the exception path (suppression is not modeled).
     */
    visitWith(stmt) {
        // The dispose block carries the `with`-header facts (the `as` aliases are
        // defs, the manager expressions uses) — it runs on every exit, so attaching
        // the binding facts here is the single execution point of the bindings.
        const items = this.withItems(stmt);
        const dispose = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), this.withHeaderText(stmt));
        for (const item of items)
            this.builder.attachFacts(dispose, this.harvest.withItemFacts(item));
        const finFrame = this.cfc.pushFinalizer(dispose);
        // The body raises into the dispose (which re-propagates to the outer handler).
        this.handlers.push(dispose);
        const protectedStart = this.builder.blockCount;
        const body = this.visitBody(this.bodyBlockOf(stmt));
        this.handlers.pop();
        // Conservative exceptional edges: ANY block in the with-body may raise to the
        // dispose (an exception fires mid-block) — sound over-approximation.
        for (let b = protectedStart; b < this.builder.blockCount; b++) {
            this.builder.edge(b, dispose, 'throw');
        }
        this.cfc.pop();
        drainFinalizerPending(this.builder, finFrame, [dispose]);
        // Normal completion of the body flows into the dispose; the dispose's normal
        // exit is the with-statement's exit. The dispose re-propagates the exception
        // path to the OUTER handler (a CM normally re-raises).
        if (body)
            this.builder.connect(body.exits, dispose, 'seq');
        this.builder.edge(dispose, this.currentHandler(), 'throw');
        const entry = body?.entry ?? dispose;
        return { entry, exits: [dispose] };
    }
    /** The `with_item`s of a `with_statement` (under its `with_clause`). */
    withItems(stmt) {
        const clause = stmt.namedChildren.find((c) => c.type === 'with_clause');
        if (!clause)
            return [];
        return clause.namedChildren.filter((c) => c.type === 'with_item');
    }
    withHeaderText(stmt) {
        const clause = stmt.namedChildren.find((c) => c.type === 'with_clause');
        return clause ? `with ${clause.text}` : 'with';
    }
    /**
     * `try: BODY [except …: H]* [else: E] [finally: F]`. Mirrors the TS visitor's
     * try-route-through:
     *  - `finally` runs on every exit (normal, exception, and early jumps) — a
     *    finalizer frame for early-exit threading + a normal/exceptional join.
     *  - each `except` / except-group handler catches from the protected body.
     *  - `else` runs only if the body completed with no exception.
     */
    visitTry(stmt) {
        const bodyNode = stmt.childForFieldName('body');
        const exceptClauses = [];
        let elseClause;
        let finallyClause;
        for (let i = 0; i < stmt.namedChildCount; i++) {
            const c = stmt.namedChild(i);
            if (!c)
                continue;
            if (c.type === 'except_clause' || c.type === 'except_group_clause')
                exceptClauses.push(c);
            else if (c.type === 'else_clause')
                elseClause = c;
            else if (c.type === 'finally_clause')
                finallyClause = c;
        }
        // Build finally first — known as both a normal join and a handler target. It
        // runs OUTSIDE this try's finalizer frame (a return inside finally threads
        // only OUTER finallys).
        const finallyBlock = finallyClause
            ? (this.bodyBlockOf(finallyClause) ??
                finallyClause.namedChildren.find((c) => c.type === 'block'))
            : undefined;
        const finallyRes = finallyBlock ? this.visitSeq(this.statementsOf(finallyBlock)) : null;
        const finFrame = finallyRes ? this.cfc.pushFinalizer(finallyRes.entry) : null;
        // Each except handler. A `raise` inside a handler propagates to finally (if
        // any), else the outer handler.
        const handlerEntries = [];
        const handlerExits = [];
        for (const clause of exceptClauses) {
            if (finallyRes)
                this.handlers.push(finallyRes.entry);
            const handlerBlock = clause.namedChildren.find((c) => c.type === 'block');
            // The `except E as e:` header binds `e` — its own facts-only block in front
            // of the handler body (the binding happens once, on handler entry).
            const headFacts = this.harvest.exceptHeadFacts(clause);
            const headBlock = this.builder.newBlock(startLineOf(clause), startLineOf(clause), '', 'normal', headFacts);
            const bodyRes = handlerBlock ? this.visitSeq(this.statementsOf(handlerBlock)) : null;
            if (bodyRes) {
                this.builder.edge(headBlock, bodyRes.entry, 'seq');
                handlerExits.push(...bodyRes.exits);
            }
            else {
                handlerExits.push(headBlock); // empty handler body — header is the exit
            }
            handlerEntries.push(headBlock);
            if (finallyRes)
                this.handlers.pop();
        }
        // Handler for the try body: the first except if present, else finally, else
        // the outer handler.
        const tryHandler = handlerEntries[0] ?? finallyRes?.entry ?? this.currentHandler();
        const protectedStart = this.builder.blockCount;
        this.handlers.push(tryHandler);
        const bodyRes = bodyNode ? this.visitSeq(this.statementsOf(bodyNode)) : null;
        this.handlers.pop();
        // Conservative exceptional edges: ANY protected-region block may raise to
        // EACH handler (an unmatched exception type tries the next handler).
        if (exceptClauses.length > 0 || finallyClause) {
            const targets = handlerEntries.length > 0 ? handlerEntries : finallyRes ? [finallyRes.entry] : [];
            for (let b = protectedStart; b < this.builder.blockCount; b++) {
                for (const h of targets)
                    this.builder.edge(b, h, 'throw');
            }
        }
        // The `else` runs only on no-exception normal completion of the body.
        let normalAfterBody = bodyRes ? [...bodyRes.exits] : [];
        if (elseClause) {
            const elseRes = this.visitBody(elseClause.childForFieldName('body'));
            if (elseRes && bodyRes) {
                this.builder.connect(bodyRes.exits, elseRes.entry, 'seq');
                normalAfterBody = [...elseRes.exits];
            }
            else if (elseRes) {
                normalAfterBody = [...elseRes.exits];
            }
        }
        // Close the finalizer frame; wire crossing-jump completion legs.
        if (finFrame && finallyRes) {
            this.cfc.pop();
            drainFinalizerPending(this.builder, finFrame, finallyRes.exits);
        }
        const exits = [];
        if (finallyRes) {
            // Normal completion of (body→else) AND each handler flows through finally.
            this.builder.connect(normalAfterBody, finallyRes.entry, 'seq');
            this.builder.connect(handlerExits, finallyRes.entry, 'seq');
            exits.push(...finallyRes.exits);
            // A try with no except → an uncaught exception re-propagates after finally.
            if (handlerEntries.length === 0) {
                this.builder.connect(finallyRes.exits, this.currentHandler(), 'throw');
            }
        }
        else {
            exits.push(...normalAfterBody);
            exits.push(...handlerExits);
        }
        const entry = bodyRes?.entry ?? finallyRes?.entry ?? handlerEntries[0];
        if (entry === undefined)
            return null;
        return { entry, exits: [...new Set(exits)] };
    }
    /**
     * `match SUBJECT: case P [if guard]: BODY …`. Cases do NOT fall through (like
     * Go's switch). Each case body is dispatched from the subject block with a
     * `switch-case` edge; a `match` with no `case _` wildcard also reaches the join
     * directly (no-match path), keeping EXIT reverse-reachable.
     */
    visitMatch(stmt) {
        const subject = stmt.childForFieldName('subject');
        const dispatch = this.builder.newBlock(startLineOf(stmt), subject ? endLineOf(subject) : startLineOf(stmt), subject ? `match ${subject.text}` : 'match', 'normal', subject ? this.harvest.facts(subject) : undefined);
        const matchExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        const body = stmt.childForFieldName('body') ?? stmt.namedChildren.find((c) => c.type === 'block');
        const cases = body ? body.namedChildren.filter((c) => c.type === 'case_clause') : [];
        // A case guard (`case P if g:`) evaluates conditionally — harvest its uses
        // onto the dispatch block (a later case only tests when earlier patterns
        // didn't match; defs there are may-defs).
        for (const c of cases) {
            const guard = c.childForFieldName('guard');
            if (guard)
                this.builder.attachFacts(dispatch, this.harvest.factsConditional(guard));
        }
        this.cfc.pushSwitch(matchExit, []);
        let hasWildcard = false;
        for (const c of cases) {
            const caseBody = this.visitBody(c.childForFieldName('consequence'));
            const entry = caseBody?.entry ?? matchExit;
            this.builder.edge(dispatch, entry, 'switch-case');
            if (caseBody)
                this.builder.connect(caseBody.exits, matchExit, 'seq');
            if (this.isWildcardCase(c))
                hasWildcard = true;
        }
        this.cfc.pop();
        // No catch-all `case _` (or no cases) → a no-match path reaches the exit
        // directly. Keeps EXIT reverse-reachable even when every case body jumps.
        if (!hasWildcard)
            this.builder.edge(dispatch, matchExit, 'switch-case');
        return { entry: dispatch, exits: [matchExit] };
    }
    /** A `case _:` (bare wildcard with no guard) is the unconditional catch-all. */
    isWildcardCase(caseClause) {
        if (caseClause.childForFieldName('guard'))
            return false;
        const pattern = caseClause.namedChildren.find((c) => c.type === 'case_pattern');
        return pattern?.text.trim() === '_';
    }
    /** Nearest enclosing exception handler, or the function EXIT. */
    currentHandler() {
        return this.handlers.length ? this.handlers[this.handlers.length - 1] : this.builder.exitIndex;
    }
}
/** Build the CFG for one Python function/lambda node, or `undefined` if not modelable. */
function buildFunctionCfg(fnNode, filePath) {
    try {
        if (!PY_FUNCTION_TYPES.has(fnNode.type))
            return undefined;
        const startLine = startLineOf(fnNode);
        const endLine = endLineOf(fnNode);
        const startColumn = fnNode.startPosition.column;
        const body = fnNode.childForFieldName('body');
        if (!body)
            return undefined; // no body — nothing to model
        const builder = new CfgBuilder(filePath, startLine, endLine, startColumn);
        const harvest = new PythonHarvester(fnNode);
        const paramFacts = harvest.paramFacts();
        if (paramFacts)
            builder.attachFacts(builder.entryIndex, paramFacts);
        if (fnNode.type === 'lambda' || body.type !== 'block') {
            // `lambda x: expr` — the body is an EXPRESSION (no `block`): one block whose
            // value is returned. Threads through no finally (a lambda has none).
            const blk = builder.newBlock(startLineOf(body), endLineOf(body), body.text, 'normal', harvest.facts(body));
            builder.edge(builder.entryIndex, blk, 'seq');
            builder.edge(blk, builder.exitIndex, 'return');
            return builder.finish(harvest.bindingTable());
        }
        const walk = new PythonCfgWalk(builder, harvest);
        const res = walk.visitSeq(body.namedChildren.filter((c) => c.type !== 'comment'));
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
        console.warn(`[cfg] Python buildFunctionCfg skipped a function in ${filePath}: ${String(err)}`);
        return undefined;
    }
}
/** Whether a node is a Python function this visitor builds a CFG for. */
function isFunction(node) {
    return PY_FUNCTION_TYPES.has(node.type);
}
/** The Python CFG visitor. */
export function createPythonCfgVisitor() {
    return { buildFunctionCfg, isFunction };
}
export { PY_FUNCTION_TYPES };
