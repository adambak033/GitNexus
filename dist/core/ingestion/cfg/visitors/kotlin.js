import { CfgBuilder } from '../cfg-builder.js';
import { ControlFlowContext, drainFinalizerPending, wireJumpThroughFinalizers, } from '../control-flow-context.js';
import { KotlinHarvester } from './kotlin-harvest.js';
/** Kotlin node types that own a CFG-bearing function body. */
const KOTLIN_FUNCTION_TYPES = new Set([
    'function_declaration',
    'anonymous_function',
    'lambda_literal',
]);
/** Statement node types that break a basic block (everything else coalesces). */
const CONTROL_FLOW_TYPES = new Set([
    'if_expression',
    'when_expression',
    'for_statement',
    'while_statement',
    'do_while_statement',
    'try_expression',
    'jump_expression',
    'label',
]);
/** Comment / non-code node types tree-sitter-kotlin surfaces (NOT `comment`). */
const COMMENT_TYPES = new Set(['line_comment', 'multiline_comment', 'shebang_line']);
const startLineOf = (n) => n.startPosition.row + 1;
const endLineOf = (n) => n.endPosition.row + 1;
const isComment = (n) => COMMENT_TYPES.has(n.type);
/**
 * Per-function Kotlin walk state. One instance per function so the
 * {@link ControlFlowContext}, exception-handler stack, and labeled-frame
 * bookkeeping are scoped to that function and never leak across functions.
 */
class KotlinCfgWalk {
    builder;
    harvest;
    cfc = new ControlFlowContext();
    /** Stack of exception-handler entry blocks (catch/finally) a `throw` jumps to. */
    handlers = [];
    /** Label(s) pending attachment to the NEXT pushed loop frame. */
    pendingLabels = [];
    constructor(builder, harvest) {
        this.builder = builder;
        this.harvest = harvest;
    }
    /** Named statements of a `statements` node, ignoring comments. */
    statementsOf(block) {
        return block.namedChildren.filter((c) => !isComment(c));
    }
    /**
     * Unwrap a `control_structure_body`: a `{ statements }` block yields its
     * `statements` node; a bare single statement (`if (c) a()`) yields itself.
     */
    bodyOf(csb) {
        if (!csb)
            return undefined;
        if (csb.type === 'control_structure_body') {
            const stmts = csb.namedChildren.find((c) => c.type === 'statements');
            if (stmts)
                return stmts;
            const single = csb.namedChildren.find((c) => !isComment(c));
            return single;
        }
        return csb;
    }
    /** Visit a `control_structure_body` (block or single statement). */
    visitBody(csb) {
        return this.builder.withNesting(() => {
            const inner = this.bodyOf(csb);
            if (!inner)
                return null;
            if (inner.type === 'statements')
                return this.visitSeq(this.statementsOf(inner));
            return this.visitStmt(inner);
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
                        continue; // transparent (empty nested block / label-only)
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
    /**
     * Whether a statement breaks the current straight-line block. `if` / `when` /
     * `try` are EXPRESSIONS in Kotlin — they break a block when used as a STATEMENT
     * (a direct child of a `statements` list), OR when they are the value of a
     * `val/var x = <branch>` binding or an `x = <branch>` assignment (#2205) —
     * `visitStmt`'s `property_declaration` / `assignment` case then models the arms
     * as control flow. A call argument value position still coalesces (a remaining
     * gap — the branch is nested in a call, harder to bind).
     */
    isControlFlow(stmt) {
        if (stmt.type === 'label')
            return true; // queue label, emit no block
        if (stmt.type === 'property_declaration') {
            const v = this.directValue(stmt);
            return v !== undefined && this.isModelableValueBranch(v);
        }
        if (stmt.type === 'assignment')
            return this.assignmentBranch(stmt) !== undefined;
        if (!CONTROL_FLOW_TYPES.has(stmt.type))
            return false;
        if (this.isExpressionConstruct(stmt.type))
            return this.isStatementPosition(stmt);
        return true;
    }
    isExpressionConstruct(type) {
        return type === 'if_expression' || type === 'when_expression' || type === 'try_expression';
    }
    /**
     * Whether an expression-construct (`if`/`when`/`try`) is in STATEMENT position
     * (a direct `statements` child, or a `control_structure_body` that is itself a
     * bare statement) vs an expression VALUE (nested under a declaration / jump /
     * assignment / argument). Statement-position constructs are modeled as
     * dispatch/branch; value-position ones stay inline.
     */
    isStatementPosition(node) {
        const p = node.parent;
        if (!p)
            return false;
        return p.type === 'statements' || p.type === 'control_structure_body';
    }
    /** Dispatch one statement to its handler. Non-null except for empty / label-only. */
    visitStmt(stmt) {
        if (stmt.type === 'label') {
            // A label preceding its loop — queue it; the loop construct picks it up.
            const name = this.labelName(stmt);
            if (name !== undefined)
                this.pendingLabels = [...this.pendingLabels, name];
            return null; // emits no block of its own
        }
        switch (stmt.type) {
            case 'if_expression':
                return this.isStatementPosition(stmt) ? this.visitIf(stmt) : this.visitSimple(stmt);
            case 'when_expression':
                return this.isStatementPosition(stmt) ? this.visitWhen(stmt) : this.visitSimple(stmt);
            case 'try_expression':
                return this.isStatementPosition(stmt) ? this.visitTry(stmt) : this.visitSimple(stmt);
            case 'for_statement':
                return this.visitFor(stmt);
            case 'while_statement':
                return this.visitWhile(stmt);
            case 'do_while_statement':
                return this.visitDoWhile(stmt);
            case 'jump_expression':
                return this.visitJump(stmt);
            case 'property_declaration': {
                // `val x = when (k) { … }` / `val x = if (c) a else b` (#2205): the value
                // is a value-position branch — model it as control flow and bind the
                // result on the rejoin, instead of collapsing the whole decl to one block.
                const value = this.directValue(stmt);
                if (value && this.isModelableValueBranch(value))
                    return this.visitBindBranch(stmt, value);
                return this.visitSimple(stmt);
            }
            case 'assignment': {
                // `x = when (k) { … }` / `x = if (c) a else b` / `x = try { … }` (#2205):
                // model the RHS branch as control flow and bind the target on the rejoin.
                const branch = this.assignmentBranch(stmt);
                if (branch)
                    return this.visitBindAssign(stmt, branch);
                return this.visitSimple(stmt);
            }
            default:
                return this.visitSimple(stmt);
        }
    }
    visitSimple(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        return { entry: idx, exits: [idx] };
    }
    // ── jump expressions (return / throw / break / continue) ──────────────────
    /** The leading anonymous keyword of a `jump_expression` decides its kind. */
    jumpKeyword(stmt) {
        const first = stmt.child(0);
        return first?.text ?? '';
    }
    visitJump(stmt) {
        const kw = this.jumpKeyword(stmt);
        if (kw === 'return' || kw === 'return@')
            return this.visitReturn(stmt);
        if (kw === 'throw')
            return this.visitThrow(stmt);
        if (kw === 'break' || kw === 'break@')
            return this.visitBreak(stmt);
        if (kw === 'continue' || kw === 'continue@')
            return this.visitContinue(stmt);
        // Unknown jump — straight through (defensive; the grammar emits only the above).
        return this.visitSimple(stmt);
    }
    /** `return [expr]` / `return@label` — threads through every active finalizer. */
    visitReturn(stmt) {
        // `return when (k) { … }` / `return if (c) a else b` / `return try { … }`
        // (#2205): the returned value is a value-position branch — model it as control
        // flow, with each arm returning (its value IS the function result), threading
        // finalizers per arm.
        const branch = stmt.namedChildren.find((c) => c.type === 'when_expression' || c.type === 'if_expression' || c.type === 'try_expression');
        if (branch && this.isModelableValueBranch(branch)) {
            const res = this.visitBranchExpr(branch);
            const finalizers = this.cfc.finalizersForReturn();
            for (const ex of res.exits) {
                wireJumpThroughFinalizers(this.builder, ex, finalizers, this.builder.exitIndex, 'return');
            }
            return { entry: res.entry, exits: [] };
        }
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        wireJumpThroughFinalizers(this.builder, idx, this.cfc.finalizersForReturn(), this.builder.exitIndex, 'return');
        return { entry: idx, exits: [] };
    }
    /** `throw e` — routes to the nearest enclosing handler (catch/finally), else EXIT. */
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
    /** The target `label` of a `break@outer` / `continue@outer` / `return@x`, if any. */
    jumpLabel(stmt) {
        const label = stmt.namedChildren.find((c) => c.type === 'label');
        return label ? this.stripLabel(label.text) : undefined;
    }
    /** The name of a `label` sibling (`outer@` ⇒ `outer`; jump target `outer` ⇒ `outer`). */
    labelName(label) {
        const id = label.namedChildren.find((c) => c.type === 'simple_identifier');
        if (id?.text)
            return this.stripLabel(id.text);
        return this.stripLabel(label.text) || undefined;
    }
    stripLabel(text) {
        return text.replace(/@$/, '').replace(/^@/, '').trim();
    }
    /** Take and clear the labels queued by a preceding `label` sibling. */
    takeLabels() {
        const labels = this.pendingLabels;
        this.pendingLabels = [];
        return labels;
    }
    // ── branches ──────────────────────────────────────────────────────────────
    /**
     * The direct value expression of a `= VALUE` carrier (`property_declaration`,
     * a `function_body` expression body): the first named child after the `=`
     * token. Returns the DIRECT value only — `val x = f(when …)` yields the call,
     * not the nested `when`, so an argument-position branch is left inline (#2205).
     */
    directValue(stmt) {
        let sawEq = false;
        for (let i = 0; i < stmt.childCount; i++) {
            const c = stmt.child(i);
            if (!c)
                continue;
            if (c.type === '=') {
                sawEq = true;
                continue;
            }
            if (sawEq && c.isNamed && !isComment(c))
                return c;
        }
        return undefined;
    }
    /**
     * Whether `node` is a value-position branch worth modeling as control flow
     * (#2205): a `when` with ≥2 arms, or an `if` that has an `else` (a value-position
     * `if` always does). A single-arm `when` / else-less `if` carries no real
     * control dependence, so it stays an inline {@link visitSimple} block.
     */
    isModelableValueBranch(node) {
        if (node.type === 'when_expression') {
            return node.namedChildren.filter((c) => c.type === 'when_entry').length >= 2;
        }
        if (node.type === 'if_expression')
            return this.elseNodeOf(node) !== undefined;
        // `val x = try { … } catch { … }` / `try { … } finally { … }` (#2205): a
        // value-position `try` with a `catch` OR a `finally` is a real branch — its
        // value is the body's value, a catch's value, or the body's value threaded
        // through a finalizer — so model it as control flow.
        if (node.type === 'try_expression') {
            return node.namedChildren.some((c) => c.type === 'catch_block' || c.type === 'finally_block');
        }
        return false;
    }
    /**
     * Model a value-position `when`/`if`/`try` as control flow regardless of its
     * statement/value position — {@link visitStmt}'s `isStatementPosition` gate keeps
     * value-position branches inline, so call the branch handlers directly here.
     */
    visitBranchExpr(node) {
        if (node.type === 'when_expression')
            return this.visitWhen(node);
        if (node.type === 'try_expression')
            return this.visitTry(node) ?? this.visitSimple(node);
        return this.visitIf(node);
    }
    /**
     * `val x = <branch>` (#2205): visit the branch as control flow, then rejoin its
     * arms at a facts-only continuation carrying ONLY the bound name's def (the
     * subject + arm-value uses are already harvested onto the branch's blocks). The
     * arms are now control-dependent on the branch condition, and `x` is defined at
     * the join — mirrors the Rust visitor's value-position `let` handling.
     */
    visitBindBranch(stmt, branch) {
        const res = this.visitBranchExpr(branch);
        const cont = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), '', 'normal', this.harvest.bindingDefFacts(stmt));
        this.builder.connect(res.exits, cont, 'seq');
        return { entry: res.entry, exits: [cont] };
    }
    /**
     * The value-position branch on a plain `=` assignment RHS (`x = when (k) {…}` /
     * `x = if (c) a else b` / `x = try {…}`, #2205), or undefined. Only a plain `=`
     * (not a compound `+=`) with a modelable-branch RHS qualifies.
     */
    assignmentBranch(stmt) {
        if (stmt.type !== 'assignment')
            return undefined;
        const eq = stmt.children.find((c) => !c.isNamed && c.text === '=');
        if (!eq)
            return undefined; // compound assignment (`+=` etc.) is not a carrier
        const rhs = stmt.namedChildren.find((c) => c.type !== 'directly_assignable_expression' && !isComment(c));
        return rhs && this.isModelableValueBranch(rhs) ? rhs : undefined;
    }
    /**
     * `x = <branch>` (#2205): visit the RHS branch as control flow, then rejoin its
     * arms at a facts-only continuation carrying ONLY the LHS target def (the branch
     * subject + arm-value uses are already on the branch's blocks). The arms are now
     * control-dependent on the branch — mirrors the Ruby value-branch assignment.
     */
    visitBindAssign(stmt, branch) {
        const res = this.visitBranchExpr(branch);
        const cont = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), '', 'normal', this.harvest.assignmentDefFacts(stmt));
        this.builder.connect(res.exits, cont, 'seq');
        return { entry: res.entry, exits: [cont] };
    }
    /**
     * A `fun f() = EXPR` expression body (#2205). A value-position branch is modeled
     * as control flow (each arm yields the returned function result); any other
     * expression stays one block. The caller wires entry ← ENTRY and exits → EXIT
     * with a `return` edge (the body's value is the function's result).
     */
    visitExprBody(expr) {
        if (this.isModelableValueBranch(expr))
            return this.visitBranchExpr(expr);
        const blk = this.builder.newBlock(startLineOf(expr), endLineOf(expr), expr.text, 'normal', this.harvest.facts(expr));
        return { entry: blk, exits: [blk] };
    }
    /**
     * `if ( COND ) control_structure_body [ else (control_structure_body |
     * if_expression) ]`. The else child after the `else` keyword is either the
     * else body (`control_structure_body`) or a nested `if_expression` (`else if`).
     */
    visitIf(stmt) {
        const cond = this.parenCondition(stmt);
        const header = this.builder.newBlock(startLineOf(stmt), cond ? endLineOf(cond) : startLineOf(stmt), cond ? `if (${cond.text})` : 'if', 'normal', cond ? this.harvest.facts(cond) : undefined);
        const bodies = stmt.namedChildren.filter((c) => c.type === 'control_structure_body');
        const elseNode = this.elseNodeOf(stmt);
        const exits = [];
        const thenRes = this.visitBody(bodies[0]);
        if (thenRes) {
            this.builder.edge(header, thenRes.entry, 'cond-true');
            exits.push(...thenRes.exits);
        }
        else {
            exits.push(header); // empty then — true path falls through
        }
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
    /**
     * The node after the `else` keyword: a nested `if_expression` (`else if`) or the
     * else-body `control_structure_body`.
     */
    elseNodeOf(stmt) {
        let sawElse = false;
        for (let i = 0; i < stmt.childCount; i++) {
            const c = stmt.child(i);
            if (!c)
                continue;
            if (sawElse && c.isNamed)
                return c;
            if (c.type === 'else')
                sawElse = true;
        }
        return undefined;
    }
    /** The condition expression of an `if`/`while` (the named child between `(` and `)`). */
    parenCondition(stmt) {
        let sawOpen = false;
        for (let i = 0; i < stmt.childCount; i++) {
            const c = stmt.child(i);
            if (!c)
                continue;
            if (c.type === '(') {
                sawOpen = true;
                continue;
            }
            if (c.type === ')')
                return undefined;
            if (sawOpen && c.isNamed && !isComment(c))
                return c;
        }
        return undefined;
    }
    // ── when (no fallthrough) ──────────────────────────────────────────────────
    /**
     * `when when_subject? { when_entry* }`. Arms do NOT fall through — each
     * `when_entry` body rejoins after the `when`. The subject (and each entry's
     * `when_condition` tests) evaluate before the body; their uses are harvested
     * onto the dispatch block (a later entry's test runs only when earlier ones
     * didn't match, so any binding there is a may-def).
     */
    visitWhen(stmt) {
        const labels = this.takeLabels();
        const subject = stmt.namedChildren.find((c) => c.type === 'when_subject');
        const dispatch = this.builder.newBlock(startLineOf(stmt), subject ? endLineOf(subject) : startLineOf(stmt), subject ? `when ${subject.text}` : 'when', 'normal', subject ? this.harvest.whenSubjectFacts(subject) : undefined);
        const whenExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushSwitch(whenExit, labels);
        const entries = stmt.namedChildren.filter((c) => c.type === 'when_entry');
        // Each entry's case tests evaluate conditionally before its body.
        for (const entry of entries) {
            for (const test of this.entryConditions(entry)) {
                this.builder.attachFacts(dispatch, this.harvest.factsConditional(test));
            }
        }
        const entryResults = entries.map((e) => this.visitBody(this.entryBody(e)));
        const hasElse = entries.some((e) => this.entryIsElse(e));
        for (const res of entryResults) {
            // An EMPTY-body arm still dispatches — it falls straight to the join. Wiring
            // it (rather than skipping) keeps the dispatch from ending up with ZERO
            // successors, which would orphan whenExit and break EXIT reverse-reachability
            // (so the whole function's CDG gets dropped). The canonical trigger is an
            // all-empty `when` with an `else` arm — `when(k){0->{};else->{}}` — where the
            // no-match edge below is suppressed. The builder dedups, so this coexists
            // with the no-match edge.
            this.builder.edge(dispatch, res ? res.entry : whenExit, 'switch-case');
        }
        // A `when` with no `else` (statement position) may match no arm — the no-match
        // path falls straight to the join.
        if (!hasElse)
            this.builder.edge(dispatch, whenExit, 'switch-case');
        const exits = [whenExit];
        // Each non-empty arm rejoins after the when (no fallthrough); an empty arm's
        // dispatch edge already targets whenExit above.
        for (const res of entryResults) {
            if (!res)
                continue;
            this.builder.connect(res.exits, whenExit, 'seq');
        }
        this.cfc.pop();
        return { entry: dispatch, exits };
    }
    /** The `when_condition` test(s) of a `when_entry` (empty for an `else` arm). */
    entryConditions(entry) {
        return entry.namedChildren.filter((c) => c.type === 'when_condition');
    }
    /** The body `control_structure_body` of a `when_entry`. */
    entryBody(entry) {
        return entry.namedChildren.find((c) => c.type === 'control_structure_body');
    }
    /** An `else ->` arm has an `else` keyword child and no `when_condition`. */
    entryIsElse(entry) {
        return entry.children.some((c) => c.type === 'else');
    }
    // ── loops ───────────────────────────────────────────────────────────────
    /** `for ( PAT in COLLECTION ) control_structure_body`. */
    visitFor(stmt) {
        const labels = this.takeLabels();
        const collection = this.forCollection(stmt);
        const header = this.builder.newBlock(startLineOf(stmt), collection ? endLineOf(collection) : startLineOf(stmt), this.forHeaderText(stmt), 'normal', this.harvest.forHeadFacts(stmt));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, labels);
        const body = this.visitBody(this.loopBody(stmt));
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
    /** The iterated collection of a `for` — the named child after `in` before `)`. */
    forCollection(stmt) {
        let sawIn = false;
        for (let i = 0; i < stmt.childCount; i++) {
            const c = stmt.child(i);
            if (!c)
                continue;
            if (c.type === 'in') {
                sawIn = true;
                continue;
            }
            if (c.type === ')')
                return undefined;
            if (sawIn && c.isNamed && !isComment(c))
                return c;
        }
        return undefined;
    }
    forHeaderText(stmt) {
        const pat = stmt.namedChildren.find((c) => c.type === 'variable_declaration' || c.type === 'multi_variable_declaration');
        const collection = this.forCollection(stmt);
        const p = pat?.text ?? '';
        const col = collection?.text ?? '';
        return p || col ? `for (${p} in ${col})` : 'for';
    }
    /** The loop body `control_structure_body` (the LAST one — for/while/do). */
    loopBody(stmt) {
        const all = stmt.namedChildren.filter((c) => c.type === 'control_structure_body');
        return all.length ? all[all.length - 1] : undefined;
    }
    /** `while ( COND ) control_structure_body`. */
    visitWhile(stmt) {
        const labels = this.takeLabels();
        const cond = this.parenCondition(stmt);
        const header = this.builder.newBlock(startLineOf(stmt), cond ? endLineOf(cond) : startLineOf(stmt), cond ? `while (${cond.text})` : 'while', 'normal', cond ? this.harvest.facts(cond) : undefined);
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, labels);
        const body = this.visitBody(this.loopBody(stmt));
        this.cfc.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, header, 'loop-back');
        }
        else {
            this.builder.edge(header, header, 'loop-back'); // empty body re-tests
        }
        // Structural exit edge — even `while (true) {}` keeps EXIT reverse-reachable.
        this.builder.edge(header, loopExit, 'cond-false');
        return { entry: header, exits: [loopExit] };
    }
    /**
     * `do control_structure_body while ( COND )` — BOTTOM-TEST: the body runs at
     * least once, THEN the condition decides whether to loop back.
     */
    visitDoWhile(stmt) {
        const labels = this.takeLabels();
        const cond = this.doWhileCondition(stmt);
        const condBlock = this.builder.newBlock(cond ? startLineOf(cond) : endLineOf(stmt), cond ? endLineOf(cond) : endLineOf(stmt), cond ? `while (${cond.text})` : 'while', 'normal', cond ? this.harvest.facts(cond) : undefined);
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        // `continue` re-tests the condition; `break` leaves the loop.
        this.cfc.pushLoop(condBlock, loopExit, labels);
        const body = this.visitBody(this.loopBody(stmt));
        this.cfc.pop();
        const backTarget = body ? body.entry : condBlock;
        if (body)
            this.builder.connect(body.exits, condBlock, 'seq');
        this.builder.edge(condBlock, backTarget, 'loop-back'); // cond true → run body again
        // Structural exit edge — even `do {} while (true)` keeps EXIT reachable.
        this.builder.edge(condBlock, loopExit, 'cond-false');
        return { entry: backTarget, exits: [loopExit] };
    }
    /** The condition of a `do … while ( COND )` — the named child after the trailing `while`. */
    doWhileCondition(stmt) {
        let sawWhile = false;
        for (let i = 0; i < stmt.childCount; i++) {
            const c = stmt.child(i);
            if (!c)
                continue;
            if (c.type === 'while') {
                sawWhile = true;
                continue;
            }
            if (sawWhile && c.type === ')')
                return undefined;
            if (sawWhile && c.isNamed && !isComment(c))
                return c;
        }
        return undefined;
    }
    // ── try / catch / finally ──────────────────────────────────────────────────
    /**
     * `try { statements } catch_block* finally_block?`. The `finally` runs on BOTH
     * normal and exception exit (finally semantics) — a `return`/`break`/`continue`
     * crossing it threads through and gets a `finally-*` completion edge. Mirrors
     * the Java `visitTry`.
     */
    visitTry(stmt) {
        const bodyNode = stmt.namedChildren.find((c) => c.type === 'statements');
        const catchBlocks = stmt.namedChildren.filter((c) => c.type === 'catch_block');
        const finallyBlock = stmt.namedChildren.find((c) => c.type === 'finally_block');
        const finallyBody = finallyBlock?.namedChildren.find((c) => c.type === 'statements');
        // The explicit finally is a finalizer the whole protected region threads through.
        const finallyRes = finallyBody ? this.visitSeq(this.statementsOf(finallyBody)) : null;
        const finallyFrame = finallyRes ? this.cfc.pushFinalizer(finallyRes.entry) : null;
        const finalizerEntry = finallyRes?.entry;
        const finalizerExits = finallyRes?.exits ?? null;
        // Build each catch handler.
        const catchEntries = [];
        const catchExits = [];
        let firstCatchEntry;
        for (const clause of catchBlocks) {
            const clauseBody = clause.namedChildren.find((c) => c.type === 'statements');
            if (finalizerEntry !== undefined)
                this.handlers.push(finalizerEntry);
            let res = clauseBody ? this.visitSeq(this.statementsOf(clauseBody)) : null;
            if (finalizerEntry !== undefined)
                this.handlers.pop();
            if (res === null) {
                // Empty `catch {}` still catches — synthesize one block so exception flow
                // lands somewhere and post-try code stays reachable.
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
        // Handler for the try body: first catch if present, else the finally, else outer.
        const tryHandler = firstCatchEntry ?? finalizerEntry ?? this.currentHandler();
        const protectedStart = this.builder.blockCount;
        this.handlers.push(tryHandler);
        let bodyRes = bodyNode ? this.visitSeq(this.statementsOf(bodyNode)) : null;
        this.handlers.pop();
        if (bodyRes === null && (catchBlocks.length > 0 || finalizerEntry !== undefined)) {
            // An empty `try {}` body still establishes a protected region. Synthesize
            // one block (like the empty-`catch` case above) so the throw-edge loop
            // wires the catch handler(s) and the try's entry is the body — otherwise
            // the catch handler block + its error binding are orphaned (unreachable
            // from ENTRY) and control routes straight to the finally, bypassing catch.
            const idx = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), '');
            bodyRes = { entry: idx, exits: [idx] };
        }
        if (catchBlocks.length > 0 || finalizerEntry !== undefined) {
            for (let b = protectedStart; b < this.builder.blockCount; b++) {
                this.builder.edge(b, tryHandler, 'throw');
            }
        }
        // Pop the finalizer frame and drain its pending completion legs.
        if (finallyFrame && finallyRes) {
            this.cfc.pop();
            drainFinalizerPending(this.builder, finallyFrame, finallyRes.exits);
        }
        const exits = [];
        if (finalizerEntry !== undefined) {
            if (bodyRes)
                this.builder.connect(bodyRes.exits, finalizerEntry, 'seq');
            for (const e of catchExits)
                this.builder.edge(e, finalizerEntry, 'seq');
            if (finalizerExits)
                exits.push(...finalizerExits);
            // No catch → an exception re-propagates out after the finally runs.
            if (catchBlocks.length === 0 && finalizerExits) {
                this.builder.connect(finalizerExits, this.currentHandler(), 'throw');
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
/** The function/lambda body `statements`, or an expression body, or undefined. */
function bodyStatementsOf(fnNode) {
    if (fnNode.type === 'lambda_literal') {
        return fnNode.namedChildren.find((c) => c.type === 'statements');
    }
    const fb = fnNode.namedChildren.find((c) => c.type === 'function_body');
    if (!fb)
        return undefined;
    // `function_body` is `{ statements }` OR an expression body `= expr`.
    const stmts = fb.namedChildren.find((c) => c.type === 'statements');
    if (stmts)
        return stmts;
    // Expression body — return the body itself so the caller treats it as one block.
    return fb;
}
/** Build the CFG for one Kotlin function node, or `undefined` if not modelable. */
function buildFunctionCfg(fnNode, filePath) {
    try {
        if (!KOTLIN_FUNCTION_TYPES.has(fnNode.type))
            return undefined;
        const startLine = startLineOf(fnNode);
        const endLine = endLineOf(fnNode);
        const startColumn = fnNode.startPosition.column;
        // A `function_declaration` / `anonymous_function` needs a `function_body`; a
        // `lambda_literal` carries its `statements` directly. Absence of a body
        // container ⇒ an abstract / interface-member / signature-only declaration with
        // nothing to model (return undefined).
        const hasBody = fnNode.type === 'lambda_literal' ||
            fnNode.namedChildren.some((c) => c.type === 'function_body');
        if (!hasBody)
            return undefined;
        const body = bodyStatementsOf(fnNode);
        const builder = new CfgBuilder(filePath, startLine, endLine, startColumn);
        const harvest = new KotlinHarvester(fnNode);
        const paramFacts = harvest.paramFacts();
        if (paramFacts)
            builder.attachFacts(builder.entryIndex, paramFacts);
        // Expression body (`fun f() = expr` / a `function_body` that is `= expr`):
        // the body's value is returned. A value-position branch (`= when (k) { … }`)
        // is modeled as control flow so each arm is control-dependent on the
        // condition (#2205); any other expression is one block.
        if (body && body.type === 'function_body') {
            const expr = body.namedChildren.find((c) => !isComment(c) && c.type !== 'statements');
            if (expr) {
                const res = new KotlinCfgWalk(builder, harvest).visitExprBody(expr);
                builder.edge(builder.entryIndex, res.entry, 'seq');
                builder.connect(res.exits, builder.exitIndex, 'return');
                return builder.finish(harvest.bindingTable());
            }
            // `function_body` with neither statements nor an expression — empty.
            builder.edge(builder.entryIndex, builder.exitIndex, 'seq');
            return builder.finish(harvest.bindingTable());
        }
        const walk = new KotlinCfgWalk(builder, harvest);
        const res = body ? walk.visitSeq(body.namedChildren.filter((c) => !isComment(c))) : null;
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
        console.warn(`[cfg] Kotlin buildFunctionCfg skipped a function in ${filePath}: ${String(err)}`);
        return undefined;
    }
}
/** Whether a node is a Kotlin function/lambda this visitor builds a CFG for. */
function isFunction(node) {
    return KOTLIN_FUNCTION_TYPES.has(node.type);
}
/** The Kotlin CFG visitor. */
export function createKotlinCfgVisitor() {
    return { buildFunctionCfg, isFunction };
}
export { KOTLIN_FUNCTION_TYPES };
