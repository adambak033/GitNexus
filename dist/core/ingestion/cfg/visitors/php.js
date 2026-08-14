import { CfgBuilder } from '../cfg-builder.js';
import { ControlFlowContext, drainFinalizerPending, wireJumpThroughFinalizers, } from '../control-flow-context.js';
import { PhpHarvester } from './php-harvest.js';
/** PHP node types that own a CFG-bearing function body. */
const PHP_FUNCTION_TYPES = new Set([
    'function_definition',
    'method_declaration',
    'anonymous_function',
    'arrow_function',
]);
/** Statement node types that break a basic block (everything else coalesces). */
const CONTROL_FLOW_TYPES = new Set([
    'if_statement',
    'for_statement',
    'foreach_statement',
    'while_statement',
    'do_statement',
    'switch_statement',
    'try_statement',
    'return_statement',
    'break_statement',
    'continue_statement',
    'goto_statement',
    'named_label_statement',
    'compound_statement',
]);
const startLineOf = (n) => n.startPosition.row + 1;
const endLineOf = (n) => n.endPosition.row + 1;
const isComment = (n) => n.type === 'comment';
/**
 * Per-function PHP walk state. One instance per function so the
 * {@link ControlFlowContext}, exception-handler stack, and the `break N` /
 * `continue N` synthetic-label bookkeeping are scoped to that function and never
 * leak across functions.
 */
class PhpCfgWalk {
    builder;
    harvest;
    cfc = new ControlFlowContext();
    /** Stack of exception-handler entry blocks (catch / finally) a `throw` jumps to. */
    handlers = [];
    /**
     * Synthetic labels of the active loop/switch frames, innermost LAST — so the
     * N-th enclosing frame's label is `loopLabels[length - N]`. PHP's `break N` /
     * `continue N` resolve against these (no source labels exist).
     */
    loopLabels = [];
    labelSeq = 0;
    constructor(builder, harvest) {
        this.builder = builder;
        this.harvest = harvest;
    }
    /** Statements of a body node, ignoring comments. */
    statementsOf(block) {
        return block.namedChildren.filter((c) => !isComment(c));
    }
    /** The `body` block of a node (a `compound_statement` / `colon_block` / stmt). */
    bodyBlockOf(node) {
        return node.childForFieldName('body') ?? undefined;
    }
    /** Strip a `parenthesized_expression` wrapper (PHP `if`/`while` conditions). */
    unwrapParen(node) {
        if (node.type === 'parenthesized_expression') {
            const inner = node.namedChildren.find((c) => !isComment(c));
            if (inner)
                return inner;
        }
        return node;
    }
    /** Visit a body that may be a block-ish container or a single statement. */
    visitBody(node) {
        return this.builder.withNesting(() => {
            if (!node)
                return null;
            if (node.type === 'compound_statement' || node.type === 'colon_block') {
                return this.visitSeq(this.statementsOf(node));
            }
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
                // An `expression_statement` wrapping a bare `throw_expression` is a
                // terminator (PHP has no `throw_statement` node), so it breaks the block.
                // An `$x = match($v) {…}` value-position assignment breaks too (#2207).
                const breaks = CONTROL_FLOW_TYPES.has(stmt.type) ||
                    this.isThrowStatement(stmt) ||
                    this.isValueBranchAssignment(stmt);
                if (breaks) {
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
        if (this.isThrowStatement(stmt))
            return this.visitThrow(stmt);
        // `$x = match($v) { … };` (#2207): model the match arms as control flow and
        // bind the assignment target on the rejoin.
        const assign = this.assignmentBranch(stmt);
        if (assign)
            return this.visitBindAssign(stmt, assign.expr, assign.match);
        switch (stmt.type) {
            case 'if_statement':
                return this.visitIf(stmt);
            case 'for_statement':
                return this.visitFor(stmt);
            case 'foreach_statement':
                return this.visitForEach(stmt);
            case 'while_statement':
                return this.visitWhile(stmt);
            case 'do_statement':
                return this.visitDoWhile(stmt);
            case 'switch_statement':
                return this.visitSwitch(stmt);
            case 'try_statement':
                return this.visitTry(stmt);
            case 'return_statement':
                return this.visitReturn(stmt);
            case 'break_statement':
                return this.visitBreak(stmt);
            case 'continue_statement':
                return this.visitContinue(stmt);
            case 'compound_statement':
            case 'colon_block':
                return this.visitSeq(this.statementsOf(stmt));
            case 'goto_statement':
            case 'named_label_statement':
                // `goto` / labels are modeled as straight-line blocks (no jump edge — see
                // the visitor limitations); they still carry their text + facts.
                return this.visitSimple(stmt);
            default:
                return this.visitSimple(stmt);
        }
    }
    /** True for an `expression_statement` whose value is a bare `throw_expression`. */
    isThrowStatement(stmt) {
        if (stmt.type !== 'expression_statement')
            return false;
        const inner = stmt.namedChildren.find((c) => !isComment(c));
        return inner?.type === 'throw_expression';
    }
    visitSimple(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        return { entry: idx, exits: [idx] };
    }
    visitReturn(stmt) {
        // `return match($v) { … };` (#2207): the returned value is a value-position
        // branch — model it as control flow, with each arm returning (its value IS
        // the function result), threading every active finally per arm.
        const branch = stmt.namedChildren.find((c) => !isComment(c));
        if (branch && this.isModelableValueBranch(branch)) {
            const res = this.visitBranchExpr(branch);
            const finalizers = this.cfc.finalizersForReturn();
            for (const ex of res.exits) {
                wireJumpThroughFinalizers(this.builder, ex, finalizers, this.builder.exitIndex, 'return');
            }
            return { entry: res.entry, exits: [] };
        }
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        // A return crosses EVERY active finally before EXIT.
        wireJumpThroughFinalizers(this.builder, idx, this.cfc.finalizersForReturn(), this.builder.exitIndex, 'return');
        return { entry: idx, exits: [] };
    }
    visitThrow(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        this.builder.edge(idx, this.currentHandler(), 'throw');
        return { entry: idx, exits: [] };
    }
    visitBreak(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text);
        const label = this.jumpLabel(stmt);
        const res = this.cfc.resolveBreak(label);
        const { target, finalizers } = res ?? {
            target: this.builder.exitIndex,
            finalizers: this.cfc.finalizersForReturn(),
        };
        wireJumpThroughFinalizers(this.builder, idx, finalizers, target, 'break');
        return { entry: idx, exits: [] };
    }
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
    /**
     * Resolve a `break N` / `continue N` to the SYNTHETIC label of the N-th
     * enclosing loop/switch frame (innermost = 1). Returns undefined for a bare
     * `break`/`continue` (no level), so the context resolves the nearest frame as
     * usual. PHP counts BOTH loop AND switch frames for `break N` and `continue N`
     * (a `switch` acts like a loop level for `continue`), which is exactly the set
     * pushed onto {@link loopLabels} here — so one count serves both.
     */
    jumpLabel(stmt) {
        const level = this.jumpLevel(stmt);
        if (level <= 1)
            return undefined; // bare break/continue → nearest frame
        const n = this.loopLabels.length;
        if (level > n)
            return undefined; // over-deep level → conservative fallback
        return this.loopLabels[n - level];
    }
    /** The integer level of a `break N;` / `continue N;` (default 1). */
    jumpLevel(stmt) {
        const intNode = stmt.namedChildren.find((c) => c.type === 'integer');
        if (!intNode)
            return 1;
        const v = parseInt(intNode.text, 10);
        return Number.isFinite(v) && v >= 1 ? v : 1;
    }
    /** Push a fresh synthetic loop/switch label and return it. */
    nextLabel() {
        const label = `__php_lvl_${this.labelSeq++}`;
        return label;
    }
    /**
     * `if cond: … elseif cond: … else: …`. PHP has NO nested-if else chain: the
     * `if_statement` carries the condition + body plus zero-or-more `alternative`
     * fields, each an `else_if_clause` (its own condition + body) or a trailing
     * `else_clause`. The elif chain is threaded on the `cond-false` edge. Handles
     * both brace bodies and the colon (`endif`) syntax uniformly (body field).
     */
    visitIf(stmt) {
        const cond = this.condOf(stmt) ?? stmt;
        const header = this.builder.newBlock(startLineOf(stmt), endLineOf(cond), cond.text, 'normal', this.harvest.facts(cond));
        const exits = [];
        const thenRes = this.visitBody(stmt.childForFieldName('body'));
        if (thenRes) {
            this.builder.edge(header, thenRes.entry, 'cond-true');
            exits.push(...thenRes.exits);
        }
        else {
            exits.push(header); // empty then — true path falls through
        }
        const alternatives = this.alternativesOf(stmt);
        let falseFrom = header;
        for (const alt of alternatives) {
            if (alt.type === 'else_if_clause') {
                const elifCondRaw = alt.childForFieldName('condition');
                const elifCond = elifCondRaw ? this.unwrapParen(elifCondRaw) : alt;
                const elifHeader = this.builder.newBlock(startLineOf(alt), endLineOf(elifCond), elifCond.text, 'normal', this.harvest.facts(elifCond));
                this.builder.edge(falseFrom, elifHeader, 'cond-false');
                const elifRes = this.visitBody(alt.childForFieldName('body'));
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
        if (falseFrom >= 0)
            exits.push(falseFrom); // no trailing else → fall through
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
    /** The (paren-unwrapped) condition expression of an if/while/do/switch. */
    condOf(stmt) {
        const cond = stmt.childForFieldName('condition');
        return cond ? this.unwrapParen(cond) : undefined;
    }
    visitWhile(stmt) {
        const label = this.nextLabel();
        const cond = this.condOf(stmt) ?? stmt;
        const header = this.builder.newBlock(startLineOf(stmt), endLineOf(cond), cond.text, 'normal', this.harvest.facts(cond));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.loopLabels.push(label);
        this.cfc.pushLoop(header, loopExit, [label]);
        const body = this.visitBody(this.bodyBlockOf(stmt));
        this.cfc.pop();
        this.loopLabels.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, header, 'loop-back');
        }
        else {
            this.builder.edge(header, header, 'loop-back'); // empty body re-tests
        }
        // Always emit the structural exit edge — even `while (true)` keeps EXIT
        // reverse-reachable for the post-dominator / CDG pass.
        this.builder.edge(header, loopExit, 'cond-false');
        return { entry: header, exits: [loopExit] };
    }
    visitDoWhile(stmt) {
        const label = this.nextLabel();
        const cond = this.condOf(stmt) ?? stmt;
        const condBlock = this.builder.newBlock(startLineOf(cond), endLineOf(cond), cond.text, 'normal', this.harvest.facts(cond));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.loopLabels.push(label);
        this.cfc.pushLoop(condBlock, loopExit, [label]);
        const body = this.visitBody(this.bodyBlockOf(stmt));
        this.cfc.pop();
        this.loopLabels.pop();
        const backTarget = body ? body.entry : condBlock;
        if (body)
            this.builder.connect(body.exits, condBlock, 'seq');
        this.builder.edge(condBlock, backTarget, 'loop-back'); // cond true → run body again
        this.builder.edge(condBlock, loopExit, 'cond-false');
        return { entry: backTarget, exits: [loopExit] };
    }
    visitFor(stmt) {
        const label = this.nextLabel();
        const init = stmt.childForFieldName('initialize');
        const cond = stmt.childForFieldName('condition');
        const incr = stmt.childForFieldName('update');
        const header = this.builder.newBlock(startLineOf(stmt), cond ? endLineOf(cond) : startLineOf(stmt), cond ? cond.text : 'for(;;)', 'normal', cond ? this.harvest.facts(cond) : undefined);
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        let incrBlock = header;
        if (incr) {
            incrBlock = this.builder.newBlock(startLineOf(incr), endLineOf(incr), incr.text, 'normal', this.harvest.facts(incr));
            this.builder.edge(incrBlock, header, 'loop-back');
        }
        this.loopLabels.push(label);
        this.cfc.pushLoop(incrBlock, loopExit, [label]);
        const body = this.visitBody(this.bodyBlockOf(stmt));
        this.cfc.pop();
        this.loopLabels.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, incrBlock, incr ? 'seq' : 'loop-back');
        }
        else {
            this.builder.edge(header, incrBlock, 'cond-true');
            if (!incr)
                this.builder.edge(header, header, 'loop-back');
        }
        // Structural exit edge — `for (;;) {}` (no condition) still keeps EXIT
        // reverse-reachable so CDG is not silently skipped for the function.
        this.builder.edge(header, loopExit, 'cond-false');
        let entry = header;
        if (init) {
            const initBlock = this.builder.newBlock(startLineOf(init), endLineOf(init), init.text, 'normal', this.harvest.facts(init));
            this.builder.edge(initBlock, header, 'seq');
            entry = initBlock;
        }
        return { entry, exits: [loopExit] };
    }
    visitForEach(stmt) {
        const label = this.nextLabel();
        // Header text is SYNTHESIZED, so facts come from the iterable (use) + the
        // loop target variable(s) (def) directly.
        const header = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), this.forEachHeaderText(stmt), 'normal', this.harvest.foreachHeadFacts(stmt));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.loopLabels.push(label);
        this.cfc.pushLoop(header, loopExit, [label]);
        const body = this.visitBody(this.bodyBlockOf(stmt));
        this.cfc.pop();
        this.loopLabels.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, header, 'loop-back');
        }
        else {
            this.builder.edge(header, header, 'loop-back');
        }
        this.builder.edge(header, loopExit, 'cond-false');
        return { entry: header, exits: [loopExit] };
    }
    forEachHeaderText(stmt) {
        const first = stmt.namedChild(0);
        return first ? `foreach(${first.text} as …)` : 'foreach(… as …)';
    }
    visitSwitch(stmt) {
        const label = this.nextLabel();
        const value = this.condOf(stmt) ?? stmt;
        const dispatch = this.builder.newBlock(startLineOf(stmt), endLineOf(value), value.text, 'normal', this.harvest.facts(value));
        const switchExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.loopLabels.push(label);
        this.cfc.pushSwitch(switchExit, [label]);
        const body = stmt.childForFieldName('body');
        // A `switch_block` holds `case_statement`s (field `value`, fall through) and a
        // `default_statement`.
        const groups = body
            ? body.namedChildren.filter((c) => c.type === 'case_statement' || c.type === 'default_statement')
            : [];
        // Each case-test expression evaluates before its body runs — harvest its uses
        // onto the dispatch block, CONDITIONALLY (a later case test only runs when
        // earlier cases didn't match).
        for (const g of groups) {
            const test = this.caseTest(g);
            if (test)
                this.builder.attachFacts(dispatch, this.harvest.factsConditional(test));
        }
        const groupResults = groups.map((g) => this.visitSeq(this.caseStatements(g)));
        const hasDefault = groups.some((g) => g.type === 'default_statement');
        const entryOf = new Array(groups.length);
        let after = switchExit;
        for (let i = groups.length - 1; i >= 0; i--) {
            entryOf[i] = groupResults[i]?.entry ?? after;
            after = entryOf[i];
        }
        for (let i = 0; i < groups.length; i++) {
            this.builder.edge(dispatch, entryOf[i], 'switch-case');
        }
        if (!hasDefault)
            this.builder.edge(dispatch, switchExit, 'switch-case'); // no-match path
        // C-style FALLTHROUGH: a case with no break/return falls through to the next.
        for (let i = 0; i < groups.length; i++) {
            const res = groupResults[i];
            if (!res)
                continue;
            const fallTarget = i + 1 < groups.length ? entryOf[i + 1] : switchExit;
            this.builder.connect(res.exits, fallTarget, 'fallthrough');
        }
        this.cfc.pop();
        this.loopLabels.pop();
        return { entry: dispatch, exits: [switchExit] };
    }
    /** A switch group's body statements (everything but its case-test value). */
    caseStatements(group) {
        const value = group.childForFieldName('value');
        return group.namedChildren.filter((c) => c.id !== value?.id && !isComment(c));
    }
    /** The case-test value expression of a `case_statement` (default has none). */
    caseTest(group) {
        return group.childForFieldName('value') ?? undefined;
    }
    // ── value-position match expression (#2207) ─────────────────────────────────
    /**
     * The `{expr, match}` of an `$x = match($v) {…}` value-position assignment
     * carrier, or undefined. `expr` is the `assignment_expression` (for the target
     * def); `match` is the modelable `match_expression` RHS. Only a plain `=`
     * assignment qualifies (an augmented `??=` etc. is not a value-branch bind).
     */
    assignmentBranch(stmt) {
        if (stmt.type !== 'expression_statement')
            return undefined;
        const expr = stmt.namedChildren.find((c) => !isComment(c));
        if (!expr || expr.type !== 'assignment_expression')
            return undefined;
        const right = expr.childForFieldName('right');
        return right && this.isModelableValueBranch(right) ? { expr, match: right } : undefined;
    }
    /** Whether a statement is an `$x = match(…) {…}` value-branch assignment. */
    isValueBranchAssignment(stmt) {
        return this.assignmentBranch(stmt) !== undefined;
    }
    /**
     * Whether `node` is a value-position branch worth modeling as control flow
     * (#2207): a `match_expression` with ≥2 arms — a real dispatch. PHP `match` is
     * the only value-position branch (there is no `if`-expression); the ternary
     * `?:` is deliberately excluded, like elvis in Kotlin.
     */
    isModelableValueBranch(node) {
        if (node.type !== 'match_expression')
            return false;
        const block = node.childForFieldName('body');
        if (!block)
            return false;
        return (block.namedChildren.filter((c) => c.type === 'match_conditional_expression' || c.type === 'match_default_expression').length >= 2);
    }
    /** Model a value-position branch as control flow (only `match_expression`). */
    visitBranchExpr(node) {
        return this.visitMatch(node);
    }
    /**
     * Model a value-position `match($v) { c => v, default => v }` as a CFG dispatch:
     * a discriminant block, each arm's value expression a block reached by a
     * `switch-case` edge, all arms rejoining at one exit (no fallthrough — `match`
     * never falls through). The arm condition lists are harvested as conditional
     * uses on the dispatch (a later arm test runs only when earlier arms missed).
     */
    visitMatch(node) {
        const condRaw = node.childForFieldName('condition');
        const cond = condRaw ? this.unwrapParen(condRaw) : node;
        const dispatch = this.builder.newBlock(startLineOf(node), endLineOf(cond), cond.text, 'normal', this.harvest.facts(cond));
        const matchExit = this.builder.newBlock(endLineOf(node), endLineOf(node), '');
        const block = node.childForFieldName('body');
        const arms = block
            ? block.namedChildren.filter((c) => c.type === 'match_conditional_expression' || c.type === 'match_default_expression')
            : [];
        let hasDefault = false;
        for (const arm of arms) {
            const condList = arm.namedChildren.find((c) => c.type === 'match_condition_list');
            if (condList)
                this.builder.attachFacts(dispatch, this.harvest.factsConditional(condList));
            if (arm.type === 'match_default_expression')
                hasDefault = true;
            const value = this.matchArmValue(arm);
            const armBlock = this.builder.newBlock(startLineOf(value ?? arm), endLineOf(value ?? arm), (value ?? arm).text, 'normal', value ? this.harvest.facts(value) : undefined);
            this.builder.edge(dispatch, armBlock, 'switch-case');
            this.builder.edge(armBlock, matchExit, 'seq');
        }
        // `match` with no `default` throws `\UnhandledMatchError` on no match; keep
        // EXIT reachable via a conservative no-match edge when no default arm exists.
        if (!hasDefault)
            this.builder.edge(dispatch, matchExit, 'switch-case');
        return { entry: dispatch, exits: [matchExit] };
    }
    /** The value (result) expression of a match arm — its LAST named child. */
    matchArmValue(arm) {
        const named = arm.namedChildren.filter((c) => !isComment(c));
        return named[named.length - 1];
    }
    /**
     * `$x = match($v) { … }` (#2207): visit the match as control flow, then rejoin
     * its arms at a facts-only continuation carrying ONLY the LHS target def (the
     * condition + arm-value uses are already on the match's blocks). The arms are
     * now control-dependent on the dispatch — mirrors the Ruby value-branch assign.
     */
    visitBindAssign(stmt, assignExpr, branch) {
        const res = this.visitBranchExpr(branch);
        const cont = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), '', 'normal', this.harvest.assignmentDefFacts(assignExpr));
        this.builder.connect(res.exits, cont, 'seq');
        return { entry: res.entry, exits: [cont] };
    }
    /**
     * try / catch / finally. A `finally` runs on BOTH normal and exception exit —
     * a `return`/`break`/`continue` crossing it threads through it (`finally-*`
     * completion edges).
     */
    visitTry(stmt) {
        const bodyNode = stmt.childForFieldName('body');
        const catchClauses = [];
        let finallyClause;
        for (let i = 0; i < stmt.namedChildCount; i++) {
            const c = stmt.namedChild(i);
            if (c?.type === 'catch_clause')
                catchClauses.push(c);
            else if (c?.type === 'finally_clause')
                finallyClause = c;
        }
        const finallyBody = finallyClause?.childForFieldName('body');
        return this.buildProtected(bodyNode ?? null, catchClauses, finallyBody ?? null);
    }
    /**
     * Shared try/catch/finally builder (mirrors the Java visitor). `catchClauses`
     * may be empty; `finallyBody` is the explicit finally's body (or null).
     *
     * Normal completion of try AND catch flows through the finally; a throw in the
     * protected region routes to the handler; early exits crossing the finally
     * thread through it (`finally-*` completion edges).
     */
    buildProtected(bodyNode, catchClauses, finallyBody) {
        const finallyRes = finallyBody ? this.visitBody(finallyBody) : null;
        const finFrame = finallyRes ? this.cfc.pushFinalizer(finallyRes.entry) : null;
        const finalizerEntry = finallyRes?.entry;
        // Build each catch handler.
        const catchEntries = [];
        const catchExits = [];
        let firstCatchEntry;
        for (const clause of catchClauses) {
            const clauseBody = clause.childForFieldName('body');
            if (finalizerEntry !== undefined)
                this.handlers.push(finalizerEntry);
            let res = clauseBody ? this.visitBody(clauseBody) : null;
            if (finalizerEntry !== undefined)
                this.handlers.pop();
            if (res === null) {
                // Empty `catch {}` still catches — synthesize one block so exception flow
                // lands somewhere and the post-try code stays reachable.
                const idx = this.builder.newBlock(startLineOf(clause), endLineOf(clause), '');
                res = { entry: idx, exits: [idx] };
            }
            const paramFacts = this.harvest.catchParamFacts(clause);
            if (paramFacts) {
                const paramBlock = this.builder.newBlock(startLineOf(clause), startLineOf(clause), '', 'normal', paramFacts);
                this.builder.edge(paramBlock, res.entry, 'seq');
                res = { entry: paramBlock, exits: res.exits };
            }
            catchEntries.push(res.entry);
            catchExits.push(...res.exits);
            if (firstCatchEntry === undefined)
                firstCatchEntry = res.entry;
        }
        // Handler for the try body: first catch if present, else the finally, else
        // the outer handler.
        const tryHandler = firstCatchEntry ?? finalizerEntry ?? this.currentHandler();
        const protectedStart = this.builder.blockCount;
        this.handlers.push(tryHandler);
        const bodyRes = bodyNode ? this.visitBody(bodyNode) : null;
        this.handlers.pop();
        if (catchClauses.length > 0 || finalizerEntry !== undefined) {
            for (let b = protectedStart; b < this.builder.blockCount; b++) {
                this.builder.edge(b, tryHandler, 'throw');
            }
        }
        // Pop the finalizer frame and drain its pending crossing-jump legs.
        if (finFrame && finallyRes) {
            this.cfc.pop();
            drainFinalizerPending(this.builder, finFrame, finallyRes.exits);
        }
        const exits = [];
        if (finalizerEntry !== undefined && finallyRes) {
            if (bodyRes)
                this.builder.connect(bodyRes.exits, finalizerEntry, 'seq');
            for (const e of catchExits)
                this.builder.edge(e, finalizerEntry, 'seq');
            exits.push(...finallyRes.exits);
            // No catch → an exception re-propagates out after the finally runs.
            if (catchClauses.length === 0) {
                this.builder.connect(finallyRes.exits, this.currentHandler(), 'throw');
            }
        }
        else {
            if (bodyRes)
                exits.push(...bodyRes.exits);
            exits.push(...catchExits);
        }
        const entry = bodyRes?.entry ?? finalizerEntry ?? catchEntries[0];
        if (entry === undefined)
            return null;
        return { entry, exits: [...new Set(exits)] };
    }
    /** Nearest enclosing exception handler, or the function EXIT. */
    currentHandler() {
        return this.handlers.length ? this.handlers[this.handlers.length - 1] : this.builder.exitIndex;
    }
}
/** Build the CFG for one PHP function node, or `undefined` if not modelable. */
function buildFunctionCfg(fnNode, filePath) {
    try {
        if (!PHP_FUNCTION_TYPES.has(fnNode.type))
            return undefined;
        const startLine = startLineOf(fnNode);
        const endLine = endLineOf(fnNode);
        const startColumn = fnNode.startPosition.column;
        const body = fnNode.childForFieldName('body');
        if (!body)
            return undefined; // abstract / interface method — no body
        const builder = new CfgBuilder(filePath, startLine, endLine, startColumn);
        const harvest = new PhpHarvester(fnNode);
        const paramFacts = harvest.paramFacts();
        if (paramFacts)
            builder.attachFacts(builder.entryIndex, paramFacts);
        if (fnNode.type === 'arrow_function' || body.type !== 'compound_statement') {
            // `fn($x) => expr` — the body is an EXPRESSION (no block): one block whose
            // value is returned.
            const blk = builder.newBlock(startLineOf(body), endLineOf(body), body.text, 'normal', harvest.facts(body));
            builder.edge(builder.entryIndex, blk, 'seq');
            builder.edge(blk, builder.exitIndex, 'return');
            return builder.finish(harvest.bindingTable());
        }
        const walk = new PhpCfgWalk(builder, harvest);
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
        console.warn(`[cfg] PHP buildFunctionCfg skipped a function in ${filePath}: ${String(err)}`);
        return undefined;
    }
}
/** Whether a node is a PHP function this visitor builds a CFG for. */
function isFunction(node) {
    return PHP_FUNCTION_TYPES.has(node.type);
}
/** The PHP CFG visitor. */
export function createPhpCfgVisitor() {
    return { buildFunctionCfg, isFunction };
}
export { PHP_FUNCTION_TYPES };
