import { CallSiteFactAccumulator as FactAccumulator, finalizeChain } from './call-site-harvest.js';
/** Node types that own a nested CFG — their subtrees are opaque to harvesting. */
const NESTED_FUNCTION_TYPES = new Set([
    'function_declaration',
    'anonymous_function',
    'lambda_literal',
]);
const COMMENT_TYPES = new Set(['line_comment', 'multiline_comment', 'shebang_line']);
export class KotlinHarvester {
    fnNode;
    bindings = [];
    /** Single function-scope name → binding index (v1: no block scope). */
    table = new Map();
    synthetic = new Map();
    fnId;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    conditionalDepth = 0;
    /**
     * `call_expression` node id → binding indices its single-target result is
     * assigned to (`val x = f()` / `x = g()` ⇒ `[x]`). Populated just before the
     * value walk reaches the call (see {@link registerResultDefs}) and consumed by
     * {@link visitCall}. Mirrors the Go / Python / Dart harvesters' `resultDefTargets`.
     */
    resultDefTargets = new Map();
    constructor(fnNode) {
        this.fnNode = fnNode;
        this.fnId = fnNode.id;
        this.declareParams(fnNode);
        const body = this.bodyOf(fnNode);
        if (body)
            this.prescan(body);
    }
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable() {
        return this.bindings;
    }
    /** The function/lambda body subtree to pre-scan (`statements` or `function_body`). */
    bodyOf(fnNode) {
        if (fnNode.type === 'lambda_literal') {
            return fnNode.namedChildren.find((c) => c.type === 'statements');
        }
        return fnNode.namedChildren.find((c) => c.type === 'function_body');
    }
    // ── phase 1: declaration pre-scan ────────────────────────────────────────
    declare(nameNode, kind) {
        const name = nameNode.text;
        if (!name || name === '_' || this.table.has(name))
            return;
        this.table.set(name, this.bindings.length);
        this.bindings.push({
            name,
            declLine: nameNode.startPosition.row + 1,
            declColumn: nameNode.startPosition.column,
            kind,
        });
    }
    /** Declare every parameter binder of a fn / anonymous fn / lambda. */
    declareParams(fnNode) {
        const params = fnNode.namedChildren.find((c) => c.type === 'function_value_parameters');
        if (params) {
            for (const p of params.namedChildren) {
                if (p.type !== 'parameter')
                    continue;
                const name = p.namedChildren.find((c) => c.type === 'simple_identifier');
                if (name)
                    this.declare(name, 'param');
            }
        }
        // Lambda params: `lambda_parameters` → `variable_declaration`(s).
        const lambdaParams = fnNode.namedChildren.find((c) => c.type === 'lambda_parameters');
        if (lambdaParams) {
            for (const vd of lambdaParams.namedChildren) {
                if (vd.type === 'variable_declaration')
                    this.declareVariableDeclaration(vd, 'param');
                else if (vd.type === 'multi_variable_declaration') {
                    for (const inner of vd.namedChildren) {
                        if (inner.type === 'variable_declaration')
                            this.declareVariableDeclaration(inner, 'param');
                    }
                }
            }
        }
    }
    /** Declare the `simple_identifier` of a `variable_declaration`. */
    declareVariableDeclaration(vd, kind) {
        const id = vd.namedChildren.find((c) => c.type === 'simple_identifier') ?? vd;
        if (id.type === 'simple_identifier')
            this.declare(id, kind);
    }
    /**
     * Pre-scan the function body once, declaring every bound name. Recurses into
     * compound expressions but NOT into nested function/lambda bodies (opaque).
     */
    prescan(node) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId)
            return;
        switch (t) {
            case 'property_declaration':
                this.declarePropertyPattern(node, 'let');
                break;
            case 'for_statement':
                this.declareForPattern(node);
                break;
            case 'catch_block':
                this.declareCatchParam(node);
                break;
            case 'when_subject':
                this.declareWhenSubject(node);
                break;
            default:
                break;
        }
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (c)
                this.prescan(c);
        }
    }
    /** Declare every binder of a `property_declaration`'s pattern (single or multi). */
    declarePropertyPattern(node, kind) {
        const single = node.namedChildren.find((c) => c.type === 'variable_declaration');
        if (single) {
            this.declareVariableDeclaration(single, kind);
            return;
        }
        const multi = node.namedChildren.find((c) => c.type === 'multi_variable_declaration');
        if (multi) {
            for (const vd of multi.namedChildren) {
                if (vd.type === 'variable_declaration')
                    this.declareVariableDeclaration(vd, kind);
            }
        }
    }
    /** Declare a `for` loop variable (`variable_declaration` / `multi_variable_declaration`). */
    declareForPattern(node) {
        const single = node.namedChildren.find((c) => c.type === 'variable_declaration');
        if (single) {
            this.declareVariableDeclaration(single, 'let');
            return;
        }
        const multi = node.namedChildren.find((c) => c.type === 'multi_variable_declaration');
        if (multi) {
            for (const vd of multi.namedChildren) {
                if (vd.type === 'variable_declaration')
                    this.declareVariableDeclaration(vd, 'let');
            }
        }
    }
    /** Declare a `catch (e: T)` error name. */
    declareCatchParam(node) {
        const id = node.namedChildren.find((c) => c.type === 'simple_identifier');
        if (id)
            this.declare(id, 'catch');
    }
    /** Declare a `when (val r = e)` subject binding. */
    declareWhenSubject(node) {
        const vd = node.namedChildren.find((c) => c.type === 'variable_declaration');
        if (vd)
            this.declareVariableDeclaration(vd, 'let');
    }
    // ── phase 2: per-statement fact extraction ───────────────────────────────
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node) {
        const acc = new FactAccumulator(node.startPosition.row + 1);
        this.walkValue(node, acc);
        return acc.finish();
    }
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node) {
        const acc = new FactAccumulator(node.startPosition.row + 1);
        this.conditional(() => this.walkValue(node, acc));
        return acc.finish();
    }
    /**
     * Facts for a `for ( PAT in COLLECTION )` head: the loop pattern's leaves are
     * defs, the iterated collection a use.
     */
    forHeadFacts(stmt) {
        const acc = new FactAccumulator(stmt.startPosition.row + 1);
        const collection = this.forCollection(stmt);
        if (collection)
            this.walkValue(collection, acc);
        this.defForPattern(stmt, acc);
        return acc.finish();
    }
    /** Facts for a `when` subject: a `val r = e` binds `r` (def); the expr's uses. */
    whenSubjectFacts(subject) {
        const acc = new FactAccumulator(subject.startPosition.row + 1);
        const vd = subject.namedChildren.find((c) => c.type === 'variable_declaration');
        // Walk the subject's value expression(s) for uses; bind the `val` name.
        for (const c of subject.namedChildren) {
            if (c.type === 'variable_declaration')
                continue;
            this.walkValue(c, acc);
        }
        if (vd)
            this.defVariableDeclaration(vd, acc);
        return acc.finish();
    }
    /**
     * Def-ONLY facts for a value-position binding carrier (`val x = <branch>`,
     * #2205): just the bound name's def, attached to the continuation block the
     * branch arms rejoin. The branch subject + arm-value USES are already harvested
     * onto the branch's own blocks (visitWhen / visitIf), so this must not re-walk
     * them — only the `variable_declaration` leaves are defs here.
     */
    bindingDefFacts(stmt) {
        const acc = new FactAccumulator(stmt.startPosition.row + 1);
        this.defForPattern(stmt, acc);
        return acc.defCount() ? acc.finish() : undefined;
    }
    /**
     * Def-ONLY facts for a value-position assignment carrier (`x = when (k) {…}`,
     * #2205): just the LHS target, attached to the continuation block the branch
     * arms rejoin. The branch subject + arm-value USES are already harvested onto
     * the branch's own blocks, so this must NOT re-walk the RHS — only a plain `=`
     * to a simple-identifier lvalue defines (a member / index target is not a
     * scalar def; a compound `+=` is not a value-branch carrier).
     */
    assignmentDefFacts(node) {
        if (this.assignmentOperator(node) !== '=')
            return undefined;
        const acc = new FactAccumulator(node.startPosition.row + 1);
        const lvalue = node.namedChildren.find((c) => c.type === 'directly_assignable_expression');
        if (lvalue) {
            const lv = this.unwrapAssignable(lvalue);
            if (lv.type === 'simple_identifier')
                this.def(lv, acc);
        }
        return acc.defCount() ? acc.finish() : undefined;
    }
    /** ENTRY-block facts for the parameters (defs only). */
    paramFacts() {
        const acc = new FactAccumulator(this.fnNode.startPosition.row + 1);
        const params = this.fnNode.namedChildren.find((c) => c.type === 'function_value_parameters');
        if (params) {
            for (const p of params.namedChildren) {
                if (p.type !== 'parameter')
                    continue;
                const name = p.namedChildren.find((c) => c.type === 'simple_identifier');
                if (name)
                    this.def(name, acc);
            }
        }
        const lambdaParams = this.fnNode.namedChildren.find((c) => c.type === 'lambda_parameters');
        if (lambdaParams) {
            for (const vd of lambdaParams.namedChildren) {
                if (vd.type === 'variable_declaration')
                    this.defVariableDeclaration(vd, acc);
                else if (vd.type === 'multi_variable_declaration') {
                    for (const inner of vd.namedChildren) {
                        if (inner.type === 'variable_declaration')
                            this.defVariableDeclaration(inner, acc);
                    }
                }
            }
        }
        return acc.defCount() ? acc.finish() : undefined;
    }
    /** Def fact for a `catch (e: T)` error name — prepend to the handler entry block. */
    catchParamFacts(catchBlock) {
        const id = catchBlock.namedChildren.find((c) => c.type === 'simple_identifier');
        if (!id)
            return undefined;
        const acc = new FactAccumulator(catchBlock.startPosition.row + 1);
        this.def(id, acc);
        return acc.defCount() ? acc.finish() : undefined;
    }
    resolve(nameNode) {
        const name = nameNode.text;
        const idx = this.table.get(name);
        if (idx !== undefined)
            return idx;
        let syn = this.synthetic.get(name);
        if (syn === undefined) {
            syn = this.bindings.length;
            this.synthetic.set(name, syn);
            this.bindings.push({ name, declLine: 0, declColumn: 0, kind: 'module', synthetic: true });
        }
        return syn;
    }
    def(nameNode, acc) {
        if (nameNode.text === '_')
            return; // blank target defines nothing
        if (this.conditionalDepth > 0)
            acc.addMayDef(this.resolve(nameNode));
        else
            acc.addDef(this.resolve(nameNode));
    }
    use(nameNode, acc) {
        if (nameNode.text === '_')
            return;
        acc.addUse(this.resolve(nameNode));
    }
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    conditional(fn) {
        this.conditionalDepth++;
        try {
            fn();
        }
        finally {
            this.conditionalDepth--;
        }
    }
    /** Def the `simple_identifier` of a `variable_declaration`. */
    defVariableDeclaration(vd, acc) {
        const id = vd.namedChildren.find((c) => c.type === 'simple_identifier');
        if (id)
            this.def(id, acc);
    }
    /** Def every binder of a `for` loop pattern. */
    defForPattern(stmt, acc) {
        const single = stmt.namedChildren.find((c) => c.type === 'variable_declaration');
        if (single) {
            this.defVariableDeclaration(single, acc);
            return;
        }
        const multi = stmt.namedChildren.find((c) => c.type === 'multi_variable_declaration');
        if (multi) {
            for (const vd of multi.namedChildren) {
                if (vd.type === 'variable_declaration')
                    this.defVariableDeclaration(vd, acc);
            }
        }
    }
    /** The iterated collection of a `for_statement` — the named child after `in`. */
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
            if (sawIn && c.isNamed && !COMMENT_TYPES.has(c.type))
                return c;
        }
        return undefined;
    }
    /** Value-position walk: collect uses; route def positions to the pattern handler. */
    walkValue(node, acc) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId)
            return; // opaque
        switch (t) {
            case 'simple_identifier':
                this.use(node, acc);
                return;
            case 'property_declaration': {
                // Walk the value for uses, then def each pattern binder.
                const binder = node.namedChildren.find((c) => c.type === 'variable_declaration' || c.type === 'multi_variable_declaration');
                const value = this.propertyValue(node);
                // Register result-defs BEFORE the value walk so the call site (reached
                // during the walk) carries them — single `variable_declaration` binder
                // only (`val x = f()`); a `multi_variable_declaration` destructuring
                // (`val (a, b) = p`) attaches nothing.
                if (value && binder?.type === 'variable_declaration') {
                    const id = binder.namedChildren.find((c) => c.type === 'simple_identifier');
                    if (id)
                        this.registerResultDefs(value, [id]);
                }
                if (value)
                    this.walkValue(value, acc);
                if (binder?.type === 'variable_declaration')
                    this.defVariableDeclaration(binder, acc);
                else if (binder?.type === 'multi_variable_declaration') {
                    for (const vd of binder.namedChildren) {
                        if (vd.type === 'variable_declaration')
                            this.defVariableDeclaration(vd, acc);
                    }
                }
                return;
            }
            case 'assignment': {
                const lvalue = node.namedChildren.find((c) => c.type === 'directly_assignable_expression');
                const op = this.assignmentOperator(node);
                const value = this.assignmentValue(node);
                const scalar = lvalue ? this.unwrapAssignable(lvalue) : undefined;
                // Plain `x = f(a)` attaches `resultDefs: [x]` (a compound `x += f(a)`
                // does not — the prior value flows in too; a member/index lvalue is not
                // a scalar def).
                if (value && op === '=' && scalar?.type === 'simple_identifier') {
                    this.registerResultDefs(value, [scalar]);
                }
                if (value)
                    this.walkValue(value, acc);
                if (lvalue) {
                    const lv = scalar ?? this.unwrapAssignable(lvalue);
                    if (lv.type === 'simple_identifier') {
                        this.def(lv, acc);
                        if (op !== '=')
                            this.use(lv, acc); // compound assign reads too
                    }
                    else {
                        // `this.x = …`, `a[i] = …` — root is a use only (not a scalar def).
                        this.walkValue(lv, acc);
                    }
                }
                return;
            }
            case 'postfix_expression':
            case 'prefix_expression': {
                // `x++` / `--x` — def AND use the operand when it is a plain identifier
                // and the operator is an increment/decrement. Other pre/postfix forms
                // (`-x`, `!x`, `x!!`, `x?`) are pure reads → walk the operand as a use.
                const operand = node.namedChild(0);
                if (operand?.type === 'simple_identifier' && this.isIncDec(node)) {
                    this.def(operand, acc);
                    this.use(operand, acc);
                }
                else if (operand) {
                    this.walkValue(operand, acc);
                }
                return;
            }
            case 'call_expression':
                // #2227 follow-up: explicit case (previously default-descended) — same
                // uses, plus a taint-site record. Kotlin has no `new` (constructor calls
                // are plain `call_expression`s). Defs/uses stay byte-identical.
                this.visitCall(node, acc);
                return;
            case 'navigation_expression': {
                // `a.b` / `a?.b` — value read of the chain root only; the suffix name is
                // not a scalar binding. Records the chain-root use (identical to the old
                // descent) plus at most ONE member-read site (the innermost access),
                // mirroring the Go / Python harvesters' value-position `walkChain`.
                this.walkChain(node, acc, false);
                return;
            }
            case 'conjunction_expression':
            case 'disjunction_expression': {
                // `a && b` / `a || b` — the right operand is conditionally evaluated.
                const operands = node.namedChildren.filter((c) => !COMMENT_TYPES.has(c.type));
                if (operands.length > 0)
                    this.walkValue(operands[0], acc);
                for (let i = 1; i < operands.length; i++) {
                    const rhs = operands[i];
                    this.conditional(() => this.walkValue(rhs, acc));
                }
                return;
            }
            case 'elvis_expression': {
                // `a ?: b` — the right operand only evaluates when the left is null.
                const operands = node.namedChildren.filter((c) => !COMMENT_TYPES.has(c.type));
                if (operands.length > 0)
                    this.walkValue(operands[0], acc);
                for (let i = 1; i < operands.length; i++) {
                    const rhs = operands[i];
                    this.conditional(() => this.walkValue(rhs, acc));
                }
                return;
            }
            case 'when_subject':
            case 'user_type':
            case 'type_identifier':
            case 'binding_pattern_kind':
                // Binding keyword / type position — no scalar value uses.
                return;
            default:
                for (let i = 0; i < node.namedChildCount; i++) {
                    const c = node.namedChild(i);
                    if (c)
                        this.walkValue(c, acc);
                }
        }
    }
    /** True iff `node` carries a `++` / `--` operator token (`x++` / `--x`). */
    isIncDec(node) {
        for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (c && !c.isNamed && (c.text === '++' || c.text === '--'))
                return true;
        }
        return false;
    }
    /** The `= value` expression of a `property_declaration` (the child after `=`). */
    propertyValue(node) {
        let sawEq = false;
        for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (!c)
                continue;
            if (c.type === '=') {
                sawEq = true;
                continue;
            }
            if (sawEq && c.isNamed && !COMMENT_TYPES.has(c.type))
                return c;
        }
        return undefined;
    }
    /** The assignment operator text (`=` / `+=` / …) of an `assignment`. */
    assignmentOperator(node) {
        for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (c && !c.isNamed && /^[+\-*/%]?=$/.test(c.type))
                return c.type;
        }
        return '=';
    }
    /** The right-hand value of an `assignment` (the named child after the operator). */
    assignmentValue(node) {
        let sawOp = false;
        for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (!c)
                continue;
            if (!c.isNamed && /^[+\-*/%]?=$/.test(c.type)) {
                sawOp = true;
                continue;
            }
            if (sawOp && c.isNamed && !COMMENT_TYPES.has(c.type))
                return c;
        }
        return undefined;
    }
    /** Strip a `directly_assignable_expression` wrapper around an lvalue. */
    unwrapAssignable(node) {
        let n = node;
        let hops = 4;
        while (n.type === 'directly_assignable_expression' && hops-- > 0) {
            const inner = n.namedChild(0);
            if (!inner)
                break;
            n = inner;
        }
        return n;
    }
    // ── taint-site harvest (#2227 follow-up) ─────────────────────────────────
    /** Strip `parenthesized_expression` wrappers around a value (`(f())`). */
    unwrapValue(node) {
        let n = node;
        let hops = 8;
        while (n.type === 'parenthesized_expression' && hops-- > 0) {
            const inner = n.namedChild(0);
            if (!inner)
                break;
            n = inner;
        }
        return n;
    }
    /**
     * When `value`'s root (after stripping parens) is a `call_expression`, remember
     * that call site should carry `resultDefs` — the binding indices of `targets`
     * (def-position identifiers). Consumed by {@link visitCall} once the value walk
     * reaches the node. Single-target only (the caller restricts to a plain
     * identifier binder); the blank target (`_`) binds nothing and is skipped.
     */
    registerResultDefs(value, targets) {
        const root = this.unwrapValue(value);
        if (root.type !== 'call_expression')
            return;
        const defs = [];
        for (const target of targets) {
            if (target.type !== 'simple_identifier' || target.text === '_')
                continue;
            defs.push(this.resolve(target));
        }
        if (defs.length > 0)
            this.resultDefTargets.set(root.id, defs);
    }
    /**
     * The callee node of a `call_expression` — the first named child that is NOT
     * the trailing `call_suffix` (a bare `simple_identifier` for a free call, or a
     * `navigation_expression` for a member/chained call).
     */
    calleeOf(call) {
        for (let i = 0; i < call.namedChildCount; i++) {
            const c = call.namedChild(i);
            if (c && c.type !== 'call_suffix' && !COMMENT_TYPES.has(c.type))
                return c;
        }
        return undefined;
    }
    /**
     * Explicit `call_expression` handler. Records a call site (callee path,
     * receiver, per-arg occurrence entries, result defs, spread marker) while
     * reproducing EXACTLY the uses the old default descent recorded (callee chain
     * root + arguments). Kotlin has no `new` — every site is `kind: 'call'`.
     */
    visitCall(node, acc) {
        const calleeNode = this.calleeOf(node);
        // `node` IS the `call_expression` — the SAME node the scope query anchors
        // `@reference.call.free/.member` on (its `atRange`), so the resolved-id join
        // lands by exact position (see file header ANCHOR ALIGNMENT).
        const siteIdx = acc.openCallSite('call', [
            node.startPosition.row + 1,
            node.startPosition.column,
        ]);
        acc.pushFrame(siteIdx);
        if (calleeNode) {
            const callee = this.unwrapValue(calleeNode);
            if (callee.type === 'simple_identifier') {
                // A bare free call — the callee NAME is a statement-level use but NOT a
                // value occurrence in any enclosing argument.
                if (callee.text !== '_')
                    acc.addUseWithoutOccurrence(this.resolve(callee));
                acc.setSiteCallee(siteIdx, callee.text);
            }
            else if (callee.type === 'navigation_expression') {
                // skipFinalRead: the final `.name` IS the callee, carried by the path.
                const chain = this.walkChain(callee, acc, true);
                if (chain.path !== undefined)
                    acc.setSiteCallee(siteIdx, chain.path);
                if (chain.rootIdx !== undefined)
                    acc.setSiteReceiver(siteIdx, chain.rootIdx);
            }
            else {
                // Call-rooted chains (`f().g()`), indexing (`m[k]()`), parenthesized
                // callables — the walk still records uses and nested sites; the callee
                // path is not statically known.
                this.walkValue(callee, acc);
            }
        }
        const resultDefs = this.resultDefTargets.get(node.id);
        if (resultDefs !== undefined)
            acc.setSiteResultDefs(siteIdx, resultDefs);
        const suffix = node.namedChildren.find((c) => c.type === 'call_suffix');
        if (suffix)
            this.walkArguments(suffix, siteIdx, acc);
        acc.popFrame();
    }
    /**
     * Walk a `call_suffix`'s `value_arguments`, tagging each positional / named /
     * spread argument's occurrence position. A trailing `annotated_lambda` is a
     * nested function body — opaque (its `lambda_literal` is excluded by
     * {@link NESTED_FUNCTION_TYPES}), so it is not an argument occurrence here.
     */
    walkArguments(suffix, siteIdx, acc) {
        const args = suffix.namedChildren.find((c) => c.type === 'value_arguments');
        if (!args)
            return;
        let pos = 0;
        for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i);
            if (!arg || arg.type !== 'value_argument')
                continue;
            acc.setFrameArg(pos);
            const value = this.argumentValue(arg);
            if (value?.type === 'spread_expression') {
                // `f(*xs)` — a spread. Mark the first spread position so the matcher
                // degrades soundly; the inner value still walks for occurrences.
                acc.setSiteSpread(siteIdx, pos);
                const inner = value.namedChild(0);
                if (inner)
                    this.walkValue(inner, acc);
            }
            else if (value) {
                this.walkValue(value, acc);
            }
            pos++;
        }
    }
    /**
     * The value expression of a `value_argument` — for a named argument
     * (`name = value`) the leading `simple_identifier` name is dropped (it is a
     * parameter name, not a use), and only the value after `=` is returned; a
     * positional argument's value is its sole non-comment named child.
     */
    argumentValue(arg) {
        // A named arg carries an anon `=` token; the value is the named child after
        // it (skipping the leading `simple_identifier` name).
        let sawEq = false;
        for (let i = 0; i < arg.childCount; i++) {
            const c = arg.child(i);
            if (!c)
                continue;
            if (!c.isNamed && c.type === '=') {
                sawEq = true;
                continue;
            }
            if (sawEq && c.isNamed && !COMMENT_TYPES.has(c.type))
                return c;
        }
        // Positional arg — the first non-comment named child.
        for (let i = 0; i < arg.namedChildCount; i++) {
            const c = arg.namedChild(i);
            if (c && c.type !== 'annotation' && !COMMENT_TYPES.has(c.type))
                return c;
        }
        return undefined;
    }
    /**
     * `navigation_expression` chain walk shared by value position and callee
     * position. Records the chain-root identifier as a use (identical to the old
     * default descent) plus at most ONE member-read site — the INNERMOST access —
     * when the root is an identifier; `skipFinalRead` suppresses it when that
     * access is the callee (carried by the dotted path instead). Mirrors the Go /
     * Python harvesters' `walkChain`.
     */
    walkChain(node, acc, skipFinalRead) {
        const accesses = [];
        let cur = this.unwrapValue(node);
        for (;;) {
            if (cur.type === 'navigation_expression') {
                const suffix = cur.namedChildren.find((c) => c.type === 'navigation_suffix');
                const name = suffix?.namedChildren.find((c) => c.type === 'simple_identifier');
                accesses.unshift(name?.text ?? '');
                const operand = cur.namedChild(0);
                if (!operand)
                    break;
                cur = this.unwrapValue(operand);
            }
            else {
                break;
            }
        }
        // The shared terminal: root-use record + innermost member-read + path-join.
        return finalizeChain(acc, cur, accesses, skipFinalRead, (t) => t === 'simple_identifier', {
            resolve: (n) => this.resolve(n),
            walkRoot: (n) => this.walkValue(n, acc),
        });
    }
}
