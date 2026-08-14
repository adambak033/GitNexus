import { CfgBuilder } from '../cfg-builder.js';
import { ControlFlowContext, wireJumpThroughFinalizers } from '../control-flow-context.js';
import { drainFinalizerPending } from '../control-flow-context.js';
import { SwiftHarvester } from './swift-harvest.js';
/** Swift node types that own a CFG-bearing function body. */
const SWIFT_FUNCTION_TYPES = new Set([
    'function_declaration',
    'init_declaration',
    'deinit_declaration',
    'lambda_literal',
]);
/** Statement node types that break a basic block (everything else coalesces). */
const CONTROL_FLOW_TYPES = new Set([
    'if_statement',
    'guard_statement',
    'for_statement',
    'while_statement',
    'repeat_while_statement',
    'switch_statement',
    'do_statement',
    'control_transfer_statement',
    'statements',
]);
const startLineOf = (n) => n.startPosition.row + 1;
const endLineOf = (n) => n.endPosition.row + 1;
/**
 * Per-function Swift walk state. One instance per function so the
 * {@link ControlFlowContext}, the `defer` finalizer chain, and the label tables
 * are scoped to that function and never leak across functions.
 */
class SwiftCfgWalk {
    builder;
    harvest;
    cfc = new ControlFlowContext();
    /** Stack of `do`/`catch` handler entry blocks a `throw`/`try` jumps to. */
    handlers = [];
    /** Label(s) pending attachment to the NEXT pushed loop/switch frame. */
    pendingLabels = [];
    /**
     * Active `defer` finalizer frames in source (push) order. Innermost-LIFO is the
     * REVERSE of this list. Frames stay active for the whole function tail and are
     * drained once at the top-level walk's end (mirrors the Go visitor).
     */
    deferFrames = [];
    constructor(builder, harvest) {
        this.builder = builder;
        this.harvest = harvest;
    }
    /** Statements of a `statements` node, ignoring comments. */
    statementsOf(block) {
        return block.namedChildren.filter((c) => c.type !== 'comment' && c.type !== 'multiline_comment');
    }
    /** The body `statements` of a loop/branch node (the LAST `statements` child). */
    bodyStatements(node) {
        const all = node.namedChildren.filter((c) => c.type === 'statements');
        return all.length ? all[all.length - 1] : undefined;
    }
    /** Visit a body that is a `statements` node (or a single statement). */
    visitBody(node) {
        return this.builder.withNesting(() => {
            if (!node)
                return null;
            if (node.type === 'statements')
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
                        continue; // transparent (empty nested block / label)
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
                    // A straight-line statement may contain a `try` — it can error-return.
                    this.wireTryExits(stmt, openSimple);
                }
            }
            if (entry === undefined)
                return null;
            return { entry, exits: dangling };
        });
    }
    /** Whether a statement node breaks the current straight-line block. */
    isControlFlow(stmt) {
        if (stmt.type === 'statement_label')
            return true; // queue label, emit no block
        if (this.isDeferCall(stmt))
            return true;
        // `let x = if … / switch …` (Swift 5.9, #2207): a value-position branch breaks
        // so `visitStmt` models the arms as control flow instead of coalescing.
        if (stmt.type === 'property_declaration') {
            const v = this.directValue(stmt);
            return v !== undefined && this.isModelableValueBranch(v);
        }
        return CONTROL_FLOW_TYPES.has(stmt.type);
    }
    /** Dispatch one statement to its handler. Non-null except for empty / label-only. */
    visitStmt(stmt) {
        if (stmt.type === 'statement_label') {
            // A label preceding its loop/switch — queue it; the construct picks it up.
            const name = this.labelName(stmt);
            if (name !== undefined)
                this.pendingLabels = [...this.pendingLabels, name];
            return null; // emits no block of its own
        }
        if (this.isDeferCall(stmt))
            return this.visitDefer(stmt);
        switch (stmt.type) {
            case 'property_declaration': {
                // `let x = if … / switch …` (Swift 5.9, #2207): the value is a value-
                // position branch — model it as control flow and bind on the rejoin.
                const value = this.directValue(stmt);
                if (value && this.isModelableValueBranch(value))
                    return this.visitBindBranch(stmt, value);
                return this.visitSimple(stmt);
            }
            case 'if_statement':
                return this.visitIf(stmt);
            case 'guard_statement':
                return this.visitGuard(stmt);
            case 'for_statement':
                return this.visitFor(stmt);
            case 'while_statement':
                return this.visitWhile(stmt);
            case 'repeat_while_statement':
                return this.visitRepeatWhile(stmt);
            case 'switch_statement':
                return this.visitSwitch(stmt);
            case 'do_statement':
                return this.visitDo(stmt);
            case 'control_transfer_statement':
                return this.visitControlTransfer(stmt);
            case 'statements':
                return this.visitSeq(this.statementsOf(stmt));
            default:
                return this.visitSimple(stmt);
        }
    }
    visitSimple(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        this.wireTryExits(stmt, idx);
        return { entry: idx, exits: [idx] };
    }
    // ── control transfer (break / continue / return / throw) ─────────────────
    /** The leading keyword of a `control_transfer_statement` decides its kind. */
    transferKeyword(stmt) {
        const first = stmt.child(0);
        return first?.text ?? '';
    }
    visitControlTransfer(stmt) {
        const kw = this.transferKeyword(stmt);
        switch (kw) {
            case 'return':
                return this.visitReturn(stmt);
            case 'throw':
                return this.visitThrow(stmt);
            case 'break':
                return this.visitBreak(stmt);
            case 'continue':
                return this.visitContinue(stmt);
            default:
                // `fallthrough` standalone (rare outside a switch) / unknown — straight
                // through (the switch handler treats the in-case `fallthrough` keyword).
                return this.visitSimple(stmt);
        }
    }
    /** `return [expr]` — threads through every active `defer` (LIFO) before EXIT. */
    visitReturn(stmt) {
        // `return if … / switch …` (Swift 5.9, #2207): the returned value is a value-
        // position branch — model it as control flow, with each arm returning (its
        // value IS the function result), threading every active finalizer per arm.
        const branch = stmt.namedChildren.find((c) => c.type === 'if_statement' || c.type === 'switch_statement');
        if (branch && this.isModelableValueBranch(branch)) {
            const res = this.visitBranchExpr(branch);
            const finalizers = this.cfc.finalizersForReturn();
            for (const ex of res.exits) {
                wireJumpThroughFinalizers(this.builder, ex, finalizers, this.builder.exitIndex, 'return');
            }
            return { entry: res.entry, exits: [] };
        }
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        this.wireTryExits(stmt, idx);
        wireJumpThroughFinalizers(this.builder, idx, this.cfc.finalizersForReturn(), this.builder.exitIndex, 'return');
        return { entry: idx, exits: [] };
    }
    /** `throw e` — routes to the nearest enclosing `catch` handler, else EXIT. */
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
    /** The `result` label of a `break outer` / `continue outer`, if any. */
    jumpLabel(stmt) {
        const result = stmt.childForFieldName('result');
        return result?.type === 'simple_identifier' ? result.text : undefined;
    }
    /** The bare name of a `statement_label` (`outer:` ⇒ `outer`). */
    labelName(label) {
        const id = label.namedChildren.find((c) => c.type === 'simple_identifier');
        if (id?.text)
            return id.text;
        const stripped = label.text.replace(/:\s*$/, '').trim();
        return stripped || undefined;
    }
    /** Take and clear the labels queued by a preceding `statement_label`. */
    takeLabels() {
        const labels = this.pendingLabels;
        this.pendingLabels = [];
        return labels;
    }
    // ── value-position branches (#2207) ─────────────────────────────────────────
    /**
     * The value-position branch of a `property_declaration` (`let x = if … / switch
     * …`, Swift 5.9): the direct `if_statement` / `switch_statement` child (the value
     * after `=`), or undefined. tree-sitter-swift reuses the statement nodes for the
     * value form — there is no separate `if_expression` / `switch_expression`.
     */
    directValue(stmt) {
        return stmt.namedChildren.find((c) => c.type === 'if_statement' || c.type === 'switch_statement');
    }
    /**
     * Whether `node` is a value-position branch worth modeling as control flow
     * (#2207): an `if` with an `else` (a value-position `if` always has one), or a
     * `switch` with ≥2 entries — a real dispatch. The ternary `?:` and `??` are
     * excluded by design (micro-branches, like the Kotlin elvis).
     */
    isModelableValueBranch(node) {
        if (node.type === 'if_statement')
            return this.elseNodeOf(node) !== undefined;
        if (node.type === 'switch_statement') {
            return node.namedChildren.filter((c) => c.type === 'switch_entry').length >= 2;
        }
        return false;
    }
    /** Model a value-position `if`/`switch` as control flow, bypassing position. */
    visitBranchExpr(node) {
        return node.type === 'switch_statement' ? this.visitSwitch(node) : this.visitIf(node);
    }
    /**
     * `let x = if … / switch …` (#2207): visit the branch as control flow, then
     * rejoin its arms at a facts-only continuation carrying ONLY the bound name's
     * def (the condition + arm-value uses are already on the branch's blocks). The
     * arms are now control-dependent on the branch — mirrors Kotlin / Rust.
     */
    visitBindBranch(stmt, branch) {
        const res = this.visitBranchExpr(branch);
        const cont = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), '', 'normal', this.harvest.bindingDefFacts(stmt));
        this.builder.connect(res.exits, cont, 'seq');
        return { entry: res.entry, exits: [cont] };
    }
    // ── branches ──────────────────────────────────────────────────────────────
    /**
     * `if COND { … } [else { … } | else if …]`. COND may be a plain expression or
     * an optional binding (`if let y = opt`). The else is the node AFTER the `else`
     * keyword — a nested `if_statement` (`else if`) or the else-body `statements`.
     */
    visitIf(stmt) {
        const header = this.builder.newBlock(startLineOf(stmt), this.conditionEndLine(stmt), this.conditionText(stmt), 'normal', this.harvest.conditionFacts(stmt, false));
        const exits = [];
        const thenRes = this.visitBody(this.thenStatements(stmt));
        if (thenRes) {
            this.builder.edge(header, thenRes.entry, 'cond-true');
            exits.push(...thenRes.exits);
        }
        else {
            exits.push(header); // empty then — true path falls through
        }
        const elseNode = this.elseNodeOf(stmt);
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
     * `guard COND else { … }` — the inverse of `if`. The `else` body runs when COND
     * is false and (per Swift) MUST diverge (return/throw/break/continue); it is
     * branched with a `cond-false` edge. The guard body CONTINUES straight-line on
     * the true path (`cond-true`).
     */
    visitGuard(stmt) {
        const header = this.builder.newBlock(startLineOf(stmt), this.conditionEndLine(stmt), this.conditionText(stmt), 'normal', this.harvest.conditionFacts(stmt, false));
        // The else body is the guard's `statements` (after the `else` keyword).
        const elseNode = this.elseNodeOf(stmt) ?? this.bodyStatements(stmt);
        if (elseNode) {
            const elseRes = this.visitBody(elseNode);
            if (elseRes) {
                this.builder.edge(header, elseRes.entry, 'cond-false');
                // The else MUST diverge; any normal exit it leaves rejoins EXIT-bound
                // flow conservatively (Swift forbids fall-through, but stay robust).
                this.builder.connect(elseRes.exits, this.builder.exitIndex, 'seq');
            }
            else {
                this.builder.edge(header, this.builder.exitIndex, 'cond-false');
            }
        }
        else {
            this.builder.edge(header, this.builder.exitIndex, 'cond-false');
        }
        // The true path continues straight-line after the guard.
        return { entry: header, exits: [header] };
    }
    /** The THEN body `statements` of an `if`/`guard` (the first `statements` child). */
    thenStatements(stmt) {
        return stmt.namedChildren.find((c) => c.type === 'statements');
    }
    /** The node after the `else` keyword: a nested `if_statement` or the else `statements`. */
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
    /** End line of a construct's condition (the last `condition`-field child). */
    conditionEndLine(stmt) {
        let line = startLineOf(stmt);
        for (let i = 0; i < stmt.childCount; i++) {
            const field = stmt.fieldNameForChild(i);
            const c = stmt.child(i);
            if (c && (field === 'condition' || field === 'bound_identifier'))
                line = endLineOf(c);
        }
        return line;
    }
    /** Display text for a construct's condition (joined `condition`-field children). */
    conditionText(stmt) {
        const parts = [];
        const kw = stmt.child(0);
        if (kw && !kw.isNamed)
            parts.push(kw.text);
        for (let i = 0; i < stmt.childCount; i++) {
            const field = stmt.fieldNameForChild(i);
            const c = stmt.child(i);
            if (c && (field === 'condition' || field === 'bound_identifier'))
                parts.push(c.text);
        }
        return parts.join(' ') || stmt.text;
    }
    // ── loops ───────────────────────────────────────────────────────────────
    /** `for item in COLLECTION [where …] { … }`. */
    visitFor(stmt) {
        const labels = this.takeLabels();
        const collection = stmt.childForFieldName('collection');
        const header = this.builder.newBlock(startLineOf(stmt), collection ? endLineOf(collection) : startLineOf(stmt), this.forHeaderText(stmt), 'normal', this.harvest.forHeadFacts(stmt));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, labels);
        const body = this.visitBody(this.bodyStatements(stmt));
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
        const item = stmt.childForFieldName('item')?.text ?? '';
        const collection = stmt.childForFieldName('collection')?.text ?? '';
        return item || collection ? `for ${item} in ${collection}` : 'for';
    }
    /** `while COND { … }` (and `while let PAT = e { … }`). */
    visitWhile(stmt) {
        const labels = this.takeLabels();
        const header = this.builder.newBlock(startLineOf(stmt), this.conditionEndLine(stmt), this.conditionText(stmt), 'normal', this.harvest.conditionFacts(stmt, true));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, labels);
        const body = this.visitBody(this.bodyStatements(stmt));
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
     * `repeat { … } while COND` — BOTTOM-TEST: the body runs at least once, THEN
     * the condition decides whether to loop back. The body entry is the loop entry;
     * the condition block is the loop-back / exit decision.
     */
    visitRepeatWhile(stmt) {
        const labels = this.takeLabels();
        const cond = stmt.childForFieldName('condition');
        const condBlock = this.builder.newBlock(cond ? startLineOf(cond) : endLineOf(stmt), cond ? endLineOf(cond) : endLineOf(stmt), cond ? `while ${cond.text}` : 'while', 'normal', cond ? this.harvest.facts(cond) : undefined);
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        // `continue` re-tests the condition; `break` leaves the loop.
        this.cfc.pushLoop(condBlock, loopExit, labels);
        const body = this.visitBody(this.bodyStatements(stmt));
        this.cfc.pop();
        const backTarget = body ? body.entry : condBlock;
        if (body)
            this.builder.connect(body.exits, condBlock, 'seq');
        this.builder.edge(condBlock, backTarget, 'loop-back'); // cond true → run body again
        // Structural exit edge — even `repeat {} while true` keeps EXIT reachable.
        this.builder.edge(condBlock, loopExit, 'cond-false');
        return { entry: backTarget, exits: [loopExit] };
    }
    // ── switch ───────────────────────────────────────────────────────────────
    /**
     * `switch EXPR { case … : … fallthrough? … default: … }`. Cases do NOT fall
     * through implicitly (the opposite of C); an explicit `fallthrough` keyword at
     * the end of a `switch_entry` spills into the NEXT entry's body. A `where` guard
     * on a case is harvested conditionally onto the dispatch block.
     */
    visitSwitch(stmt) {
        const labels = this.takeLabels();
        const value = stmt.childForFieldName('expr');
        const dispatch = this.builder.newBlock(startLineOf(stmt), value ? endLineOf(value) : startLineOf(stmt), value ? `switch ${value.text}` : 'switch', 'normal', value ? this.harvest.facts(value) : undefined);
        const switchExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushSwitch(switchExit, labels);
        const entries = stmt.namedChildren.filter((c) => c.type === 'switch_entry');
        // A case `where` guard evaluates conditionally before the body — harvest its
        // uses onto the dispatch block (a later case tests only when earlier ones
        // didn't match; any def there is a may-def).
        for (const entry of entries) {
            // `case let n` value bindings are may-defs on the dispatch block (the case
            // may not match) — propagated into the body where the name is read.
            const pat = this.entryPattern(entry);
            if (pat)
                this.builder.attachFacts(dispatch, this.harvest.switchPatternFacts(pat));
            const guard = this.entryGuard(entry);
            if (guard)
                this.builder.attachFacts(dispatch, this.harvest.factsConditional(guard));
        }
        const entryResults = entries.map((e) => this.visitBody(this.entryBody(e)));
        const hasDefault = entries.some((e) => this.entryIsDefault(e));
        const entryOf = new Array(entries.length);
        let after = switchExit;
        for (let i = entries.length - 1; i >= 0; i--) {
            entryOf[i] = entryResults[i]?.entry ?? after;
            after = entryOf[i];
        }
        for (let i = 0; i < entries.length; i++) {
            this.builder.edge(dispatch, entryOf[i], 'switch-case');
        }
        if (!hasDefault)
            this.builder.edge(dispatch, switchExit, 'switch-case'); // no-match path
        // A case body rejoins AFTER the switch (no implicit fallthrough) UNLESS the
        // entry ends in an explicit `fallthrough`, which spills into the next entry.
        for (let i = 0; i < entries.length; i++) {
            const res = entryResults[i];
            if (!res)
                continue;
            const fallsThrough = this.entryFallsThrough(entries[i]);
            const fallTarget = i + 1 < entries.length ? entryOf[i + 1] : switchExit;
            if (fallsThrough)
                this.builder.connect(res.exits, fallTarget, 'fallthrough');
            else
                this.builder.connect(res.exits, switchExit, 'seq');
        }
        this.cfc.pop();
        return { entry: dispatch, exits: [switchExit] };
    }
    /** The `switch_pattern` of a `switch_entry` (absent for `default:`). */
    entryPattern(entry) {
        return entry.namedChildren.find((c) => c.type === 'switch_pattern');
    }
    /** The `where` guard expression of a `switch_entry`, if any. */
    entryGuard(entry) {
        let sawWhere = false;
        for (let i = 0; i < entry.childCount; i++) {
            const c = entry.child(i);
            if (!c)
                continue;
            if (sawWhere && c.isNamed)
                return c;
            if (c.type === 'where_keyword')
                sawWhere = true;
        }
        return undefined;
    }
    /** The body `statements` of a `switch_entry`. */
    entryBody(entry) {
        return entry.namedChildren.find((c) => c.type === 'statements');
    }
    entryIsDefault(entry) {
        return (entry.namedChildren.some((c) => c.type === 'default_keyword') ||
            entry.children.some((c) => c.type === 'default_keyword'));
    }
    /** A `switch_entry` ends in an explicit `fallthrough` keyword child. */
    entryFallsThrough(entry) {
        for (let i = 0; i < entry.childCount; i++) {
            if (entry.child(i)?.type === 'fallthrough')
                return true;
        }
        return false;
    }
    // ── do / catch (error handling) ──────────────────────────────────────────
    /**
     * `do { … } catch [pat] { … }`. Conservative exceptional flow (mirrors the C++
     * `try`/`catch` over-approximation): every block created while walking the
     * protected `do` body edges to the FIRST catch handler — a `try`/`throw` may
     * fire mid-block. Each `catch_block`'s normal completion joins the post-`do`
     * continuation.
     */
    visitDo(stmt) {
        const bodyNode = stmt.namedChildren.find((c) => c.type === 'statements');
        const catchBlocks = stmt.namedChildren.filter((c) => c.type === 'catch_block');
        // Build each catch handler. The handler entry is the error-binding block (a
        // facts-only block) in front of the body, so the binding happens once on entry.
        const handlerEntries = [];
        const handlerExits = [];
        for (const clause of catchBlocks) {
            const clauseBody = clause.namedChildren.find((c) => c.type === 'statements');
            let res = clauseBody ? this.visitSeq(this.statementsOf(clauseBody)) : null;
            if (res === null) {
                // Empty catch body still CATCHES — synthesize one block so the error
                // lands somewhere and post-`do` code stays reachable.
                const idx = this.builder.newBlock(startLineOf(clause), endLineOf(clause), '');
                res = { entry: idx, exits: [idx] };
            }
            const errFacts = this.harvest.catchErrorFacts(clause);
            if (errFacts) {
                const errBlock = this.builder.newBlock(startLineOf(clause), startLineOf(clause), '', 'normal', errFacts);
                this.builder.edge(errBlock, res.entry, 'seq');
                res = { entry: errBlock, exits: res.exits };
            }
            handlerEntries.push(res.entry);
            handlerExits.push(...res.exits);
        }
        // The protected body's handler is the FIRST catch (if any), else the outer.
        const doHandler = handlerEntries[0] ?? this.currentHandler();
        const protectedStart = this.builder.blockCount;
        this.handlers.push(doHandler);
        const bodyRes = bodyNode ? this.visitSeq(this.statementsOf(bodyNode)) : null;
        this.handlers.pop();
        // Conservative exceptional edges: every protected-region block → EACH catch
        // handler. Swift tries the catch clauses in order until one matches; the
        // thrown type is unknown at CFG time, so any protected block may reach ANY
        // clause. Edging only the first handler orphaned the 2nd..Nth catch blocks
        // (unreachable from ENTRY, stranding their error bindings + def/use facts).
        if (handlerEntries.length > 0) {
            for (let b = protectedStart; b < this.builder.blockCount; b++) {
                for (const handler of handlerEntries)
                    this.builder.edge(b, handler, 'throw');
            }
        }
        const exits = [];
        if (bodyRes)
            exits.push(...bodyRes.exits);
        exits.push(...handlerExits);
        // No catch at all — a `do {}` without `catch` is just a scope: the body
        // flows straight through to its own normal exits (no extra edge needed).
        const entry = bodyRes?.entry ?? handlerEntries[0];
        if (entry === undefined)
            return null;
        return { entry, exits: [...new Set(exits)] };
    }
    /** Nearest enclosing `catch` handler, or the function EXIT. */
    currentHandler() {
        return this.handlers.length ? this.handlers[this.handlers.length - 1] : this.builder.exitIndex;
    }
    /**
     * Emit a `throw` edge to the nearest handler (or EXIT) for every `try`/`try?`/
     * `try!` operator inside a straight-line statement's subtree (excluding nested
     * function bodies). A `try` can propagate an error mid-statement; routing it
     * keeps the error path represented while the success path falls through.
     * Deduped by the builder, so repeated `try` in a statement emit one edge.
     */
    wireTryExits(stmt, fromBlock) {
        if (this.containsTry(stmt))
            this.builder.edge(fromBlock, this.currentHandler(), 'throw');
    }
    containsTry(node) {
        if (node.type === 'try_expression') {
            // `try?` / `try!` handle the error in-place (optional / trap), so only a
            // bare `try` propagates — but conservatively any `try` may error in a
            // throwing context; route all to the handler (deduped, low cost).
            return true;
        }
        if (SWIFT_FUNCTION_TYPES.has(node.type))
            return false; // opaque nested fn
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (c && this.containsTry(c))
                return true;
        }
        return false;
    }
    // ── defer ──────────────────────────────────────────────────────────────
    /**
     * `defer { … }` is parsed as a `call_expression` whose callee is a bare
     * `defer` identifier carrying a trailing-closure `lambda_literal`. Detect that
     * exact shape so the deferred body threads the function-exit completion chain.
     */
    isDeferCall(stmt) {
        if (stmt.type !== 'call_expression')
            return false;
        const callee = stmt.namedChild(0);
        if (!callee || callee.type !== 'simple_identifier' || callee.text !== 'defer')
            return false;
        return this.deferClosure(stmt) !== undefined;
    }
    /** The trailing-closure `lambda_literal` body of a `defer { … }` call. */
    deferClosure(stmt) {
        for (let i = 0; i < stmt.namedChildCount; i++) {
            const c = stmt.namedChild(i);
            if (c?.type === 'call_suffix') {
                const lambda = c.namedChildren.find((x) => x.type === 'lambda_literal');
                if (lambda)
                    return lambda;
            }
            if (c?.type === 'lambda_literal')
                return c;
        }
        return undefined;
    }
    /**
     * `defer { … }` — register the deferred body as a finalizer frame that stays
     * active for the rest of the function tail (mirrors the Go visitor). Every later
     * `return` AND the normal fall-off thread through it; LIFO across multiple
     * defers falls out of `finalizersForReturn()` yielding innermost-first. The
     * deferred block carries the closure body's def/use facts. The `defer` itself is
     * a no-op at its source position — control falls straight through.
     */
    visitDefer(stmt) {
        const lambda = this.deferClosure(stmt);
        const deferBlock = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', lambda ? this.harvest.facts(lambda) : undefined);
        const frame = this.cfc.pushFinalizer(deferBlock);
        this.deferFrames.push(frame);
        // The `defer` statement is a no-op inline — return a SEPARATE marker block as
        // the source position so the deferred block stays out of straight-line flow.
        const marker = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), '');
        return { entry: marker, exits: [marker] };
    }
    /**
     * Drain the active `defer` chain at function end (mirrors the Go visitor). The
     * chain runs innermost-first (LIFO). Returns the block set control reaches AFTER
     * the whole defer chain runs (to be wired to EXIT by the caller), or
     * `normalExits` unchanged when there are no defers.
     */
    finishDefers(normalExits) {
        if (this.deferFrames.length === 0)
            return normalExits;
        const lifo = [...this.deferFrames].reverse();
        for (let i = 0; i < lifo.length; i++)
            this.cfc.pop();
        for (const frame of lifo)
            drainFinalizerPending(this.builder, frame, [frame.entry]);
        if (normalExits.length > 0) {
            this.builder.connect(normalExits, lifo[0].entry, 'return');
            for (let i = 0; i + 1 < lifo.length; i++) {
                this.builder.edge(lifo[i].entry, lifo[i + 1].entry, 'finally-return');
            }
        }
        return [lifo[lifo.length - 1].entry];
    }
}
/** Build the CFG for one Swift function node, or `undefined` if not modelable. */
function buildFunctionCfg(fnNode, filePath) {
    try {
        if (!SWIFT_FUNCTION_TYPES.has(fnNode.type))
            return undefined;
        const startLine = startLineOf(fnNode);
        const endLine = endLineOf(fnNode);
        const startColumn = fnNode.startPosition.column;
        // A function/init/deinit must own a `function_body`; a lambda owns its
        // `statements` directly. Absence ⇒ a protocol requirement / signature-only
        // declaration with no body to model (return undefined). A PRESENT-but-empty
        // body is a valid empty function (ENTRY → EXIT), distinct from "no body".
        const hasBodyContainer = fnNode.childForFieldName('body') !== null ||
            fnNode.namedChildren.some((c) => c.type === 'function_body') ||
            (fnNode.type === 'lambda_literal' &&
                fnNode.namedChildren.some((c) => c.type === 'statements')) ||
            fnNode.type === 'lambda_literal';
        if (!hasBodyContainer)
            return undefined;
        const body = bodyStatementsOf(fnNode); // may be undefined for an empty body
        const builder = new CfgBuilder(filePath, startLine, endLine, startColumn);
        const harvest = new SwiftHarvester(fnNode);
        const paramFacts = harvest.paramFacts();
        if (paramFacts)
            builder.attachFacts(builder.entryIndex, paramFacts);
        const walk = new SwiftCfgWalk(builder, harvest);
        const res = body
            ? walk.visitSeq(body.namedChildren.filter((c) => c.type !== 'comment' && c.type !== 'multiline_comment'))
            : null;
        builder.edge(builder.entryIndex, res ? res.entry : builder.exitIndex, 'seq');
        // Normal fall-off threads through the active `defer` chain (LIFO) → EXIT.
        const normalExits = res ? res.exits : [builder.entryIndex];
        const afterDefers = walk.finishDefers(normalExits);
        builder.connect(afterDefers, builder.exitIndex, 'seq');
        return builder.finish(harvest.bindingTable());
    }
    catch (err) {
        // Never throw out of buildFunctionCfg — a malformed AST shape must skip only
        // this one function's CFG, never drop the whole file's language group (R4).
        // eslint-disable-next-line no-console
        console.warn(`[cfg] Swift buildFunctionCfg skipped a function in ${filePath}: ${String(err)}`);
        return undefined;
    }
}
/**
 * The function's body `statements` node. A `function_declaration` / `init_` /
 * `deinit_declaration` wraps it in a `function_body`; a `lambda_literal` carries
 * the `statements` directly (after an optional `lambda_function_type` + `in`).
 */
function bodyStatementsOf(fnNode) {
    const fb = fnNode.childForFieldName('body') ??
        fnNode.namedChildren.find((c) => c.type === 'function_body');
    if (fb && fb.type === 'function_body') {
        return fb.namedChildren.find((c) => c.type === 'statements');
    }
    if (fnNode.type === 'lambda_literal') {
        return fnNode.namedChildren.find((c) => c.type === 'statements');
    }
    return undefined;
}
/** Whether a node is a Swift function/closure this visitor builds a CFG for. */
function isFunction(node) {
    return SWIFT_FUNCTION_TYPES.has(node.type);
}
/** The Swift CFG visitor. */
export function createSwiftCfgVisitor() {
    return { buildFunctionCfg, isFunction };
}
export { SWIFT_FUNCTION_TYPES };
