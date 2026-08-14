import { CfgBuilder } from '../cfg-builder.js';
import { ControlFlowContext, drainFinalizerPending, wireJumpThroughFinalizers, } from '../control-flow-context.js';
import { DartHarvester } from './dart-harvest.js';
/** Signature node types whose SIBLING `function_body` owns a CFG-bearing body. */
const DART_SIGNATURE_TYPES = new Set([
    'function_signature',
    'method_signature',
    'getter_signature',
    'setter_signature',
    'constructor_signature',
    'factory_constructor_signature',
]);
/** Statement node types that break a basic block (everything else coalesces). */
const CONTROL_FLOW_TYPES = new Set([
    'if_statement',
    'for_statement',
    'while_statement',
    'do_statement',
    'switch_statement',
    'try_statement',
    'return_statement',
    'break_statement',
    'continue_statement',
    'assert_statement',
]);
/** Comment node types tree-sitter-dart surfaces. */
const COMMENT_TYPES = new Set(['comment', 'documentation_comment']);
const startLineOf = (n) => n.startPosition.row + 1;
const endLineOf = (n) => n.endPosition.row + 1;
const isComment = (n) => COMMENT_TYPES.has(n.type);
/** Whether an `expression_statement` is a bare `throw …;`. */
const isThrowStatement = (n) => n.type === 'expression_statement' && n.namedChildren.some((c) => c.type === 'throw_expression');
/** Whether an `expression_statement` is a bare `rethrow;`. */
const isRethrowStatement = (n) => n.type === 'expression_statement' && n.namedChildren.some((c) => c.type === 'rethrow_expression');
/**
 * Whether a node is a LABELED `continue LABEL;` (a switch fallthrough-spill),
 * vs a bare `continue;` (which targets the enclosing loop). Only the labeled form
 * is stripped from a case body and handled via {@link caseContinueLabel}.
 */
const isLabeledContinue = (n) => n.type === 'continue_statement' && n.namedChildren.some((c) => c.type === 'identifier');
/**
 * Per-function Dart walk state. One instance per function so the
 * {@link ControlFlowContext}, exception-handler stack, and labeled-frame
 * bookkeeping are scoped to that function and never leak across functions.
 */
class DartCfgWalk {
    builder;
    harvest;
    cfc = new ControlFlowContext();
    /** Stack of exception-handler entry blocks (catch/finally) a `throw` jumps to. */
    handlers = [];
    /** Label(s) pending attachment to the NEXT pushed loop/switch frame. */
    pendingLabels = [];
    constructor(builder, harvest) {
        this.builder = builder;
        this.harvest = harvest;
    }
    /** Named statements of a `block`, ignoring comments. */
    statementsOf(block) {
        return block.namedChildren.filter((c) => !isComment(c));
    }
    /** Unwrap a body STMT: a `block` yields its statements; a bare statement is itself. */
    visitBody(node) {
        return this.builder.withNesting(() => {
            if (!node)
                return null;
            if (node.type === 'block')
                return this.visitSeq(this.statementsOf(node));
            if (isComment(node))
                return null;
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
    /** Whether a statement node breaks the current straight-line block. */
    isControlFlow(stmt) {
        if (this.isLabelError(stmt))
            return true; // a stray label sibling — queue it
        if (isThrowStatement(stmt) || isRethrowStatement(stmt))
            return true;
        // `var x = switch (v) { … }` (#2207): a value-position switch breaks so
        // `visitStmt` models the arms as control flow instead of coalescing.
        if (stmt.type === 'local_variable_declaration') {
            const v = this.directValue(stmt);
            return v !== undefined && this.isModelableValueBranch(v);
        }
        return CONTROL_FLOW_TYPES.has(stmt.type);
    }
    /**
     * A labeled LOOP outside a switch (`outer: for …`) is mis-parsed by
     * tree-sitter-dart as a stray `ERROR [identifier :]` SIBLING preceding the
     * loop. Recognize that exact shape so the label still resolves a `break outer`.
     */
    isLabelError(stmt) {
        if (stmt.type !== 'ERROR')
            return false;
        const id = stmt.namedChildren.find((c) => c.type === 'identifier');
        return id !== undefined && stmt.children.some((c) => c.type === ':');
    }
    /** Dispatch one statement to its handler. Non-null except for empty / label-only. */
    visitStmt(stmt) {
        if (this.isLabelError(stmt)) {
            const id = stmt.namedChildren.find((c) => c.type === 'identifier');
            if (id?.text)
                this.pendingLabels = [...this.pendingLabels, id.text];
            return null; // emits no block of its own
        }
        if (isThrowStatement(stmt))
            return this.visitThrow(stmt);
        if (isRethrowStatement(stmt))
            return this.visitRethrow(stmt);
        switch (stmt.type) {
            case 'local_variable_declaration': {
                // `var x = switch (v) { … }` (#2207): the value is a value-position
                // branch — model it as control flow and bind the result on the rejoin.
                const value = this.directValue(stmt);
                if (value && this.isModelableValueBranch(value))
                    return this.visitBindBranch(stmt, value);
                return this.visitSimple(stmt);
            }
            case 'if_statement':
                return this.visitIf(stmt);
            case 'for_statement':
                return this.visitFor(stmt);
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
            case 'assert_statement':
                return this.visitAssert(stmt);
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
    /** Take and clear the labels queued by a preceding label sibling. */
    takeLabels() {
        const labels = this.pendingLabels;
        this.pendingLabels = [];
        return labels;
    }
    // ── jumps (return / throw / rethrow / break / continue / assert) ──────────
    /** `return [expr];` — threads through every active finalizer before EXIT. */
    visitReturn(stmt) {
        // `return switch (v) { … };` (#2207): the returned value is a value-position
        // branch — model it as control flow, with each arm returning (its value IS
        // the function result), threading every active finalizer per arm.
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
        wireJumpThroughFinalizers(this.builder, idx, this.cfc.finalizersForReturn(), this.builder.exitIndex, 'return');
        return { entry: idx, exits: [] };
    }
    /** `throw e;` — routes to the nearest enclosing handler (catch/finally), else EXIT. */
    visitThrow(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        this.builder.edge(idx, this.currentHandler(), 'throw');
        return { entry: idx, exits: [] };
    }
    /**
     * `rethrow;` — re-raises the current exception. Inside a handler it propagates
     * past the CURRENT catch to the next-outer handler / EXIT, which is exactly
     * what `currentHandler()` resolves to (the in-flight catch is not on the
     * handler stack while its own body is walked). Terminates its block.
     */
    visitRethrow(stmt) {
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
     * `assert ( cond [, msg] );` — may throw an `AssertionError`. Modeled as a
     * straight-line block that ALSO edges to the current handler (the assertion
     * may fire), so the error path stays represented while the success path falls
     * through. Conservative; deduped by the builder.
     */
    visitAssert(stmt) {
        const idx = this.builder.newBlock(startLineOf(stmt), endLineOf(stmt), stmt.text, 'normal', this.harvest.facts(stmt));
        this.builder.edge(idx, this.currentHandler(), 'throw');
        return { entry: idx, exits: [idx] };
    }
    /** The `identifier` label of a `break outer;` / `continue outer;`, if any. */
    jumpLabel(stmt) {
        const id = stmt.namedChildren.find((c) => c.type === 'identifier');
        return id?.text || undefined;
    }
    // ── branches (if/else) ─────────────────────────────────────────────────────
    /**
     * `if ( COND ) consequence:STMT [ else alternative:STMT ]`. The consequence /
     * alternative are a `block` or a bare statement; an `else if` is the nested
     * `if_statement` in the `alternative` field.
     */
    visitIf(stmt) {
        const cond = this.parenCondition(stmt);
        const header = this.builder.newBlock(startLineOf(stmt), cond ? endLineOf(cond) : startLineOf(stmt), cond ? `if (${cond.text})` : 'if', 'normal', cond ? this.harvest.facts(cond) : undefined);
        const consequence = stmt.childForFieldName('consequence');
        const alternative = stmt.childForFieldName('alternative');
        const exits = [];
        const thenRes = this.visitBody(consequence);
        if (thenRes) {
            this.builder.edge(header, thenRes.entry, 'cond-true');
            exits.push(...thenRes.exits);
        }
        else {
            exits.push(header); // empty then — true path falls through
        }
        if (alternative) {
            const elseRes = this.visitBody(alternative);
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
    /** The condition expression of an `if` — the named child between `(` and `)`. */
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
    // ── loops ───────────────────────────────────────────────────────────────
    /** `for ( for_loop_parts ) body:STMT` (C-style and for-in). */
    visitFor(stmt) {
        const labels = this.takeLabels();
        const parts = stmt.namedChildren.find((c) => c.type === 'for_loop_parts');
        const header = this.builder.newBlock(startLineOf(stmt), parts ? endLineOf(parts) : startLineOf(stmt), this.forHeaderText(stmt, parts), 'normal', this.harvest.forHeadFacts(parts));
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, labels);
        const body = this.visitBody(stmt.childForFieldName('body'));
        this.cfc.pop();
        if (body) {
            this.builder.edge(header, body.entry, 'cond-true');
            this.builder.connect(body.exits, header, 'loop-back');
        }
        else {
            this.builder.edge(header, header, 'loop-back'); // empty body re-iterates
        }
        // Structural exit edge — even `for (;;) {}` keeps EXIT reverse-reachable.
        this.builder.edge(header, loopExit, 'cond-false');
        return { entry: header, exits: [loopExit] };
    }
    forHeaderText(stmt, parts) {
        return parts ? `for ${parts.text}` : 'for';
    }
    /** `while condition:parenthesized_expression body:STMT`. */
    visitWhile(stmt) {
        const labels = this.takeLabels();
        const cond = stmt.childForFieldName('condition');
        const header = this.builder.newBlock(startLineOf(stmt), cond ? endLineOf(cond) : startLineOf(stmt), cond ? `while ${cond.text}` : 'while', 'normal', cond ? this.harvest.facts(cond) : undefined);
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        this.cfc.pushLoop(header, loopExit, labels);
        const body = this.visitBody(stmt.childForFieldName('body'));
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
     * `do body:STMT while condition:… ;` — BOTTOM-TEST: the body runs at least
     * once, THEN the condition decides whether to loop back.
     */
    visitDoWhile(stmt) {
        const labels = this.takeLabels();
        const cond = stmt.childForFieldName('condition');
        const condBlock = this.builder.newBlock(cond ? startLineOf(cond) : endLineOf(stmt), cond ? endLineOf(cond) : endLineOf(stmt), cond ? `while ${cond.text}` : 'while', 'normal', cond ? this.harvest.facts(cond) : undefined);
        const loopExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        // `continue` re-tests the condition; `break` leaves the loop.
        this.cfc.pushLoop(condBlock, loopExit, labels);
        const body = this.visitBody(stmt.childForFieldName('body'));
        this.cfc.pop();
        const backTarget = body ? body.entry : condBlock;
        if (body)
            this.builder.connect(body.exits, condBlock, 'seq');
        this.builder.edge(condBlock, backTarget, 'loop-back'); // cond true → run body again
        // Structural exit edge — even `do {} while (true)` keeps EXIT reachable.
        this.builder.edge(condBlock, loopExit, 'cond-false');
        return { entry: backTarget, exits: [loopExit] };
    }
    // ── switch (no implicit fallthrough; empty-case + continue-label spill) ─────
    /**
     * `switch condition:parenthesized_expression body:switch_block`. A non-empty
     * case rejoins after the switch (no implicit fallthrough). An EMPTY case (no
     * statements) spills into the next case (Dart empty-case fallthrough). An
     * explicit `continue LABEL;` jumps to the labeled case.
     */
    visitSwitch(stmt) {
        const labels = this.takeLabels();
        // The `condition` field is a `parenthesized_expression` (verified) — unwrap it
        // so the dispatch text/discriminant matches the value-position `visitSwitchExpr`
        // form (`switch x`, not `switch (x)`). The harvest walks into the paren either
        // way, so the def/use facts are unchanged — only the block text normalizes.
        const condRaw = stmt.childForFieldName('condition');
        const value = condRaw ? this.unwrapParen(condRaw) : undefined;
        const dispatch = this.builder.newBlock(startLineOf(stmt), value ? endLineOf(value) : startLineOf(stmt), value ? `switch ${value.text}` : 'switch', 'normal', value ? this.harvest.facts(value) : undefined);
        const switchExit = this.builder.newBlock(endLineOf(stmt), endLineOf(stmt), '');
        const block = stmt.childForFieldName('body');
        const cases = block
            ? block.namedChildren.filter((c) => c.type === 'switch_statement_case' || c.type === 'switch_statement_default')
            : [];
        this.cfc.pushSwitch(switchExit, labels);
        // Phase 1: build each case body. Register case labels so `continue LABEL`
        // can target a labeled case's entry.
        const caseBodies = [];
        const caseLabels = [];
        for (const c of cases) {
            caseLabels.push(this.caseLabel(c));
            // A case-pattern test runs conditionally before the body — harvest its
            // uses onto the dispatch block (a later case tests only if earlier ones
            // didn't match; any def there is a may-def).
            for (const pat of this.casePatterns(c)) {
                this.builder.attachFacts(dispatch, this.harvest.factsConditional(pat));
            }
            caseBodies.push(this.visitSeq(this.caseStatements(c)));
        }
        // The entry block of each case (its body, or the NEXT non-empty case's entry
        // for an empty fallthrough case, or switchExit when nothing follows).
        const entryOf = new Array(cases.length);
        let after = switchExit;
        for (let i = cases.length - 1; i >= 0; i--) {
            entryOf[i] = caseBodies[i]?.entry ?? after;
            after = entryOf[i];
        }
        // Resolve a `continue LABEL` target: the entry of the case carrying LABEL.
        const labelTarget = (name) => {
            const idx = caseLabels.findIndex((l) => l === name);
            return idx >= 0 ? entryOf[idx] : undefined;
        };
        const hasDefault = cases.some((c) => c.type === 'switch_statement_default');
        // Dispatch edges: one per case.
        for (let i = 0; i < cases.length; i++) {
            this.builder.edge(dispatch, entryOf[i], 'switch-case');
        }
        if (!hasDefault)
            this.builder.edge(dispatch, switchExit, 'switch-case'); // no-match path
        // Case-body completion: a non-empty case rejoins after the switch UNLESS it
        // ends in an explicit `continue LABEL` (handled as the body's own terminator)
        // — and an EMPTY case spills into the next case (fallthrough edge). A bare
        // `break;` inside a case is a normal break to switchExit (the jump handler).
        for (let i = 0; i < cases.length; i++) {
            const res = caseBodies[i];
            const contLabel = this.caseContinueLabel(cases[i]);
            if (!res) {
                // Empty case — spill to the next case (or switchExit).
                this.builder.edge(dispatch, i + 1 < cases.length ? entryOf[i + 1] : switchExit, 'fallthrough');
                continue;
            }
            if (contLabel) {
                const tgt = labelTarget(contLabel);
                if (tgt !== undefined)
                    this.builder.connect(res.exits, tgt, 'fallthrough');
                else
                    this.builder.connect(res.exits, switchExit, 'seq');
            }
            else {
                this.builder.connect(res.exits, switchExit, 'seq');
            }
        }
        this.cfc.pop();
        return { entry: dispatch, exits: [switchExit] };
    }
    /** The `label` name of a `switch_statement_case` (`myLabel: case …`), if any. */
    caseLabel(c) {
        const label = c.namedChildren.find((ch) => ch.type === 'label');
        const id = label?.namedChildren.find((ch) => ch.type === 'identifier');
        return id?.text || undefined;
    }
    /**
     * Case-pattern nodes of a `switch_statement_case` whose test evaluates before
     * the body — the only DISTINCT pattern node tree-sitter-dart emits is
     * `constant_pattern` (`case 1:` / `case 1 || 2:`); a relational guard
     * (`case > 5:`) is a bare `relational_operator` + operand, not a wrapper node.
     * Harvesting the `constant_pattern` uses onto the dispatch block covers the
     * common case; the rest fold into the body walk.
     */
    casePatterns(c) {
        return c.namedChildren.filter((ch) => ch.type === 'constant_pattern');
    }
    /** Body statements of a switch case/default (skip the case keyword/pattern/label). */
    caseStatements(c) {
        const NON_BODY = new Set(['case_builtin', 'label', 'constant_pattern']);
        // A LABELED `continue LABEL;` at a case tail is a fallthrough-spill, handled
        // via caseContinueLabel — drop it from the body. But a BARE `continue;` targets
        // the ENCLOSING LOOP (valid Dart) and MUST stay in the body: dropping it
        // silently removes the jump and fabricates a false case→next-statement
        // fall-through path. Only drop the labeled form.
        return c.namedChildren.filter((ch) => !isComment(ch) && !NON_BODY.has(ch.type) && !isLabeledContinue(ch));
    }
    /** A trailing `continue LABEL;` in a case spills to the labeled case. */
    caseContinueLabel(c) {
        const cont = c.namedChildren.find((ch) => isLabeledContinue(ch));
        if (!cont)
            return undefined;
        const id = cont.namedChildren.find((ch) => ch.type === 'identifier');
        return id?.text || undefined;
    }
    // ── value-position switch expression (#2207) ────────────────────────────────
    /**
     * The direct value of a `local_variable_declaration` with a SINGLE
     * `initialized_variable_definition` (`var x = <value>`): its `value` field.
     * Returns undefined for a multi-binding decl (`var a = …, b = …`) — modeling
     * those arm-by-arm is out of scope, so they coalesce inline.
     */
    directValue(stmt) {
        const defs = stmt.namedChildren.filter((c) => c.type === 'initialized_variable_definition');
        if (defs.length !== 1)
            return undefined;
        return defs[0].childForFieldName('value') ?? undefined;
    }
    /**
     * Whether `node` is a value-position branch worth modeling as control flow
     * (#2207): a `switch_expression` (Dart 3) with ≥2 arms — a real dispatch. Dart's
     * value-position `if` does not exist; the ternary `?:` is excluded by design.
     */
    isModelableValueBranch(node) {
        if (node.type !== 'switch_expression')
            return false;
        return node.namedChildren.filter((c) => c.type === 'switch_expression_case').length >= 2;
    }
    /** Model a value-position branch as control flow (only `switch_expression`). */
    visitBranchExpr(node) {
        return this.visitSwitchExpr(node);
    }
    /**
     * Model a value-position `switch (v) { p [when g] => e, _ => e }` (Dart 3) as a
     * CFG dispatch: a discriminant block, each arm's value a block reached by a
     * `switch-case` edge, all arms rejoining at one exit (no fallthrough). The arm
     * PATTERN and any `when` GUARD are harvested as conditional uses on the dispatch
     * (they evaluate before the body, only when earlier arms missed); a Dart call
     * value parses as `identifier` + `selector` (multiple children), so the arm-value
     * facts come from each post-`=>` child. Only an UNGUARDED `_` arm is the
     * exhaustive catch-all — a guarded `_ when …` is NOT (the no-match path still
     * needs the conservative edge), mirroring the C# `visitSwitchExpr`.
     */
    visitSwitchExpr(node) {
        const condRaw = node.childForFieldName('condition');
        const cond = condRaw ? this.unwrapParen(condRaw) : node;
        const dispatch = this.builder.newBlock(startLineOf(node), endLineOf(cond), `switch ${cond.text}`, 'normal', this.harvest.facts(cond));
        const switchExit = this.builder.newBlock(endLineOf(node), endLineOf(node), '');
        const arms = node.namedChildren.filter((c) => c.type === 'switch_expression_case');
        let hasCatchAll = false;
        for (const arm of arms) {
            const { pattern, guards, values } = this.armParts(arm);
            // The pattern + `when` guard are conditional dispatch tests, NOT arm-value
            // uses — harvest them onto the dispatch (mirrors casePatterns for switch_statement).
            if (pattern)
                this.builder.attachFacts(dispatch, this.harvest.factsConditional(pattern));
            for (const g of guards)
                this.builder.attachFacts(dispatch, this.harvest.factsConditional(g));
            if (pattern && pattern.text === '_' && guards.length === 0)
                hasCatchAll = true;
            const first = values[0] ?? arm;
            const last = values[values.length - 1] ?? arm;
            const armBlock = this.builder.newBlock(startLineOf(first), endLineOf(last), values.map((c) => c.text).join('') || arm.text, 'normal', undefined);
            for (const v of values)
                this.builder.attachFacts(armBlock, this.harvest.facts(v));
            this.builder.edge(dispatch, armBlock, 'switch-case');
            this.builder.edge(armBlock, switchExit, 'seq');
        }
        // A non-exhaustive Dart switch expression throws at runtime; conservatively
        // keep EXIT reachable via a no-match edge when no `_` catch-all arm exists.
        if (!hasCatchAll)
            this.builder.edge(dispatch, switchExit, 'switch-case');
        return { entry: dispatch, exits: [switchExit] };
    }
    /**
     * Split a `switch_expression_case` at the `=>` token: the PATTERN (first named
     * child before `=>`), any `when` GUARD (named children between the pattern and
     * `=>` — tree-sitter-dart parses the guard as a bare sibling, not a wrapper),
     * and the VALUE expression (named children after `=>` — a Dart call is split
     * across `identifier` + `selector`, hence an array).
     */
    armParts(arm) {
        const before = [];
        const values = [];
        let seenArrow = false;
        for (let i = 0; i < arm.childCount; i++) {
            const c = arm.child(i);
            if (!c)
                continue;
            if (!c.isNamed) {
                if (c.text === '=>')
                    seenArrow = true;
                continue;
            }
            if (isComment(c))
                continue;
            (seenArrow ? values : before).push(c);
        }
        return { pattern: before[0], guards: before.slice(1), values };
    }
    /** Strip a `parenthesized_expression` wrapper (a switch/if condition). */
    unwrapParen(node) {
        if (node.type === 'parenthesized_expression') {
            const inner = node.namedChildren.find((c) => !isComment(c));
            if (inner)
                return inner;
        }
        return node;
    }
    /**
     * `var x = switch (v) { … }` (#2207): visit the switch as control flow, then
     * rejoin its arms at a facts-only continuation carrying ONLY the declared name's
     * def (the subject + arm-value uses are already on the switch's blocks). The
     * arms are now control-dependent on the dispatch — mirrors Java / Kotlin / Rust.
     */
    visitBindBranch(stmt, branch) {
        const res = this.visitBranchExpr(branch);
        const cont = this.builder.newBlock(startLineOf(stmt), startLineOf(stmt), '', 'normal', this.harvest.bindingDefFacts(stmt));
        this.builder.connect(res.exits, cont, 'seq');
        return { entry: res.entry, exits: [cont] };
    }
    // ── try / on / catch / finally ─────────────────────────────────────────────
    /**
     * `try body:block (on TYPE? catch_clause? block)* finally_clause?`. The handler
     * groups are bare siblings: an `on type_identifier`, an optional `catch_clause`
     * (→ `catch_parameters`), and the handler `block`. The `finally` runs on BOTH
     * normal and exception exit — a `return`/`break`/`continue` crossing it threads
     * through (`finally-*` completion edges). Mirrors the Java/Kotlin `visitTry`.
     */
    visitTry(stmt) {
        const bodyNode = stmt.childForFieldName('body');
        const finallyClause = stmt.namedChildren.find((c) => c.type === 'finally_clause');
        const finallyBody = finallyClause?.namedChildren.find((c) => c.type === 'block');
        const handlerGroups = this.handlerGroups(stmt);
        // The explicit finally is a finalizer the whole protected region threads through.
        const finallyRes = finallyBody ? this.visitSeq(this.statementsOf(finallyBody)) : null;
        const finallyFrame = finallyRes ? this.cfc.pushFinalizer(finallyRes.entry) : null;
        const finalizerEntry = finallyRes?.entry;
        const finalizerExits = finallyRes?.exits ?? null;
        // Build each catch/on handler.
        const catchExits = [];
        let firstCatchEntry;
        for (const group of handlerGroups) {
            const clauseBody = group.block;
            if (finalizerEntry !== undefined)
                this.handlers.push(finalizerEntry);
            let res = clauseBody ? this.visitSeq(this.statementsOf(clauseBody)) : null;
            if (finalizerEntry !== undefined)
                this.handlers.pop();
            if (res === null) {
                // Empty `on T { }` / `catch (e) {}` still catches — synthesize one block
                // so exception flow lands somewhere and post-try code stays reachable.
                const anchor = clauseBody ?? group.catchClause ?? stmt;
                const idx = this.builder.newBlock(startLineOf(anchor), endLineOf(anchor), '');
                res = { entry: idx, exits: [idx] };
            }
            const paramFacts = this.harvest.catchParamFacts(group.catchParameters);
            if (paramFacts) {
                const anchor = group.catchParameters ?? group.catchClause ?? stmt;
                const paramBlock = this.builder.newBlock(startLineOf(anchor), startLineOf(anchor), '', 'normal', paramFacts);
                this.builder.edge(paramBlock, res.entry, 'seq');
                res = { entry: paramBlock, exits: res.exits };
            }
            catchExits.push(...res.exits);
            if (firstCatchEntry === undefined)
                firstCatchEntry = res.entry;
        }
        // Handler for the try body: first catch if present, else the finally, else outer.
        const tryHandler = firstCatchEntry ?? finalizerEntry ?? this.currentHandler();
        const protectedStart = this.builder.blockCount;
        this.handlers.push(tryHandler);
        const bodyRes = bodyNode ? this.visitSeq(this.statementsOf(bodyNode)) : null;
        this.handlers.pop();
        if (handlerGroups.length > 0 || finalizerEntry !== undefined) {
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
            if (handlerGroups.length === 0 && finalizerExits) {
                this.builder.connect(finalizerExits, this.currentHandler(), 'throw');
            }
        }
        else {
            if (bodyRes)
                exits.push(...bodyRes.exits);
            exits.push(...catchExits);
        }
        const entry = bodyRes?.entry ?? finalizerEntry ?? firstCatchEntry;
        if (entry === undefined)
            return null;
        return { entry, exits: [...new Set(exits)] };
    }
    /**
     * The handler groups of a `try_statement`: each is an `on TYPE` and/or
     * `catch (params)` plus the handler `block` that follows it. The `on`/`type`/
     * `catch_clause`/`block` are bare children in source order, so a group is a
     * `catch_clause` (or an `on` keyword + `type_identifier`) followed by a `block`.
     */
    handlerGroups(stmt) {
        const groups = [];
        const bodyNode = stmt.childForFieldName('body');
        let pendingCatch;
        let sawOn = false;
        for (let i = 0; i < stmt.childCount; i++) {
            const c = stmt.child(i);
            if (!c)
                continue;
            if (c.type === 'finally_clause')
                break; // finally is separate
            if (c.type === 'on') {
                sawOn = true;
                continue;
            }
            if (c.type === 'catch_clause') {
                pendingCatch = c;
                continue;
            }
            if (c.type === 'block' && c !== bodyNode) {
                const catchParameters = pendingCatch?.namedChildren.find((ch) => ch.type === 'catch_parameters');
                groups.push({ catchClause: pendingCatch, catchParameters, block: c });
                pendingCatch = undefined;
                sawOn = false;
            }
        }
        // A trailing `on T catch (e)` with no `{}` body is malformed; ignore here.
        void sawOn;
        return groups;
    }
    /** Nearest enclosing exception handler, or the function EXIT. */
    currentHandler() {
        return this.handlers.length ? this.handlers[this.handlers.length - 1] : this.builder.exitIndex;
    }
}
/** The signature node that precedes a `function_body` (params live there). */
function signatureFor(fnNode) {
    if (fnNode.type !== 'function_body')
        return undefined;
    const prev = fnNode.previousSibling;
    if (!prev)
        return undefined;
    if (DART_SIGNATURE_TYPES.has(prev.type))
        return prev;
    // A `method_signature` wraps a `function_signature` / getter / setter — the
    // params live on the wrapped signature for a plain method but the wrapper still
    // carries them transitively; return the wrapper (paramList searches its named
    // children, which include the `formal_parameter_list`).
    return undefined;
}
/** The body STMT of a `function_body` / `function_expression`: a `block` or an arrow expr. */
function bodyAndArrow(fnNode) {
    let container = fnNode;
    if (fnNode.type === 'function_expression') {
        container = fnNode.childForFieldName('body') ?? undefined; // function_expression_body
    }
    if (!container)
        return {};
    const block = container.namedChildren.find((c) => c.type === 'block');
    if (block)
        return { block };
    // Arrow body `=> expr`: the expression is the first non-comment named child.
    const arrowExpr = container.namedChildren.find((c) => !COMMENT_TYPES.has(c.type));
    return { arrowExpr };
}
/** Build the CFG for one Dart function node, or `undefined` if not modelable. */
function buildFunctionCfg(fnNode, filePath) {
    try {
        if (!isFunction(fnNode))
            return undefined;
        const signature = signatureFor(fnNode);
        // Anchor the span/column to the signature when present (so same-line
        // functions `void a(){} void b(){}` get distinct start columns from the
        // signature, and the span covers the declaration head), else the body node.
        const anchor = signature ?? fnNode;
        const startLine = startLineOf(anchor);
        const endLine = endLineOf(fnNode);
        const startColumn = anchor.startPosition.column;
        const { block, arrowExpr } = bodyAndArrow(fnNode);
        const builder = new CfgBuilder(filePath, startLine, endLine, startColumn);
        const harvest = new DartHarvester(fnNode, signature);
        const paramFacts = harvest.paramFacts();
        if (paramFacts)
            builder.attachFacts(builder.entryIndex, paramFacts);
        // Arrow body (`=> expr`): one block whose value is returned.
        if (!block && arrowExpr) {
            const blk = builder.newBlock(startLineOf(arrowExpr), endLineOf(arrowExpr), arrowExpr.text, 'normal', harvest.facts(arrowExpr));
            builder.edge(builder.entryIndex, blk, 'seq');
            builder.edge(blk, builder.exitIndex, 'return');
            return builder.finish(harvest.bindingTable());
        }
        const walk = new DartCfgWalk(builder, harvest);
        const res = block ? walk.visitSeq(block.namedChildren.filter((c) => !isComment(c))) : null;
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
        console.warn(`[cfg] Dart buildFunctionCfg skipped a function in ${filePath}: ${String(err)}`);
        return undefined;
    }
}
/**
 * Whether a node is a Dart function this visitor builds a CFG for: a
 * `function_body` whose previous sibling is a signature (top-level fn / method /
 * getter / setter / constructor), or a `function_expression` (a closure).
 */
function isFunction(node) {
    if (node.type === 'function_expression')
        return true;
    if (node.type !== 'function_body')
        return false;
    const prev = node.previousSibling;
    return prev !== null && DART_SIGNATURE_TYPES.has(prev.type);
}
/** The Dart CFG visitor. */
export function createDartCfgVisitor() {
    return { buildFunctionCfg, isFunction };
}
export { DART_SIGNATURE_TYPES };
