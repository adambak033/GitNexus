import { CallSiteFactAccumulator } from './call-site-harvest.js';
/** Node types that own a nested CFG — their subtrees are opaque to harvesting. */
const NESTED_FUNCTION_TYPES = new Set([
    'function_definition',
    'method_declaration',
    'anonymous_function',
    'arrow_function',
]);
export class PhpHarvester {
    fnNode;
    bindings = [];
    /** PHP is function-scoped: one flat table, name → binding index. */
    table = new Map();
    synthetic = new Map();
    fnId;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    conditionalDepth = 0;
    /**
     * Call/new node id → bindings whose declarator/assignment VALUE is exactly
     * that call. Registered before the value walk, consumed by {@link visitCall} /
     * {@link visitNew} (mirrors the Java harvester's `resultDefTargets`).
     */
    resultDefTargets = new Map();
    constructor(fnNode) {
        this.fnNode = fnNode;
        this.fnId = fnNode.id;
        this.declareParams(fnNode);
        this.declareUseClause(fnNode);
        const body = this.bodyOf(fnNode);
        if (body)
            this.prescan(body);
    }
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable() {
        return this.bindings;
    }
    /** The function/closure body node (a `compound_statement`, or an expression). */
    bodyOf(fnNode) {
        return fnNode.childForFieldName('body') ?? undefined;
    }
    // ── phase 1: declaration pre-scan ────────────────────────────────────────
    declare(name, declNode, kind) {
        if (!name || this.table.has(name))
            return;
        this.table.set(name, this.bindings.length);
        this.bindings.push({
            name,
            declLine: declNode.startPosition.row + 1,
            declColumn: declNode.startPosition.column,
            kind,
        });
    }
    /** The `$name` text of a parameter's `name` field (a `variable_name` or `by_ref`). */
    paramVarName(param) {
        const name = param.childForFieldName('name');
        if (!name)
            return undefined;
        if (name.type === 'by_ref') {
            return name.namedChildren.find((c) => c.type === 'variable_name');
        }
        return name.type === 'variable_name' ? name : undefined;
    }
    declareParams(fnNode) {
        const params = fnNode.childForFieldName('parameters');
        if (!params)
            return;
        for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i);
            if (!p)
                continue;
            if (p.type !== 'simple_parameter' &&
                p.type !== 'variadic_parameter' &&
                p.type !== 'property_promotion_parameter') {
                continue;
            }
            const varName = this.paramVarName(p);
            if (varName)
                this.declare(varName.text, varName, 'param');
        }
    }
    /** `anonymous_function ... use ($a, &$b)` — each captured var binds in the closure. */
    declareUseClause(fnNode) {
        if (fnNode.type !== 'anonymous_function')
            return;
        const clause = fnNode.namedChildren.find((c) => c.type === 'anonymous_function_use_clause');
        if (!clause)
            return;
        for (const v of this.useClauseVars(clause))
            this.declare(v.text, v, 'param');
    }
    /** The captured `variable_name`s of a `use (...)` clause (unwrapping `by_ref`). */
    useClauseVars(clause) {
        const out = [];
        for (let i = 0; i < clause.namedChildCount; i++) {
            const c = clause.namedChild(i);
            if (!c)
                continue;
            if (c.type === 'variable_name')
                out.push(c);
            else if (c.type === 'by_ref') {
                const inner = c.namedChildren.find((x) => x.type === 'variable_name');
                if (inner)
                    out.push(inner);
            }
        }
        return out;
    }
    /**
     * Walk the function body once, declaring every assigned / foreach / catch
     * variable into the FLAT function scope (PHP has no block scoping). Nested
     * function/closure bodies are NOT descended (opaque).
     */
    prescan(node) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId)
            return;
        switch (t) {
            case 'assignment_expression': {
                const left = node.childForFieldName('left');
                if (left)
                    this.declareLvalue(left);
                break;
            }
            case 'augmented_assignment_expression': {
                const left = node.childForFieldName('left');
                if (left && left.type === 'variable_name')
                    this.declare(left.text, left, 'var');
                break;
            }
            case 'update_expression': {
                const arg = node.childForFieldName('argument');
                if (arg && arg.type === 'variable_name')
                    this.declare(arg.text, arg, 'var');
                break;
            }
            case 'foreach_statement': {
                for (const v of this.foreachTargets(node))
                    this.declare(v.text, v, 'var');
                break;
            }
            case 'catch_clause': {
                const name = node.childForFieldName('name');
                if (name && name.type === 'variable_name')
                    this.declare(name.text, name, 'catch');
                break;
            }
            default:
                break;
        }
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (c)
                this.prescan(c);
        }
    }
    /**
     * Declare the variable(s) named by an assignment lvalue: a plain
     * `variable_name`, or a `list_literal` destructure (`[$a,$b]` / `list($a,$b)`,
     * possibly keyed `["x" => $e]`). Member / subscript targets bind nothing.
     */
    declareLvalue(left) {
        if (left.type === 'variable_name') {
            this.declare(left.text, left, 'var');
        }
        else if (left.type === 'list_literal') {
            for (const v of this.listTargets(left))
                this.declare(v.text, v, 'var');
        }
    }
    /** Every `variable_name` bound by a `list_literal` (including keyed entries). */
    listTargets(list) {
        const out = [];
        const walk = (n) => {
            if (n.type === 'variable_name') {
                out.push(n);
                return;
            }
            // Keyed (`"x" => $e`) entries and nested lists descend; non-variable keys
            // (the string/int key) are not lvalues and carry no `variable_name`.
            for (let i = 0; i < n.namedChildCount; i++) {
                const c = n.namedChild(i);
                if (c)
                    walk(c);
            }
        };
        for (let i = 0; i < list.namedChildCount; i++) {
            const c = list.namedChild(i);
            if (c)
                walk(c);
        }
        return out;
    }
    /**
     * The bound variable(s) of a `foreach ($it as [$k =>] $v)`: the value (and key)
     * `variable_name`s. The structure is positional — the FIRST named child is the
     * iterable, then either a bare `variable_name` (value) or a `pair` ($k => $v).
     */
    foreachTargets(stmt) {
        const out = [];
        // Skip the iterable (first named child); collect value / pair targets after.
        for (let i = 1; i < stmt.namedChildCount; i++) {
            const c = stmt.namedChild(i);
            if (!c)
                continue;
            if (c.type === 'variable_name')
                out.push(c);
            else if (c.type === 'pair') {
                for (let j = 0; j < c.namedChildCount; j++) {
                    const v = c.namedChild(j);
                    if (v?.type === 'variable_name')
                        out.push(v);
                }
            }
            // `body` (compound_statement / colon_block) is not a target — it has its
            // own non-variable_name/non-pair type, so it is skipped here.
        }
        return out;
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
     * Def-ONLY facts for a value-position assignment carrier (`$x = match($v) {…}`,
     * #2207): just the LHS target(s), attached to the continuation block the match
     * arms rejoin. The match condition + arm-value USES are already harvested onto
     * the branch's own blocks (visitMatch), so this must NOT re-walk the RHS. A
     * member/subscript target (`$this->x = match …`) has no scalar def → undefined.
     */
    assignmentDefFacts(assignExpr) {
        const acc = new FactAccumulator(assignExpr.startPosition.row + 1);
        const left = assignExpr.childForFieldName('left');
        if (left) {
            const lv = this.unwrapParen(left);
            if (lv.type === 'variable_name')
                this.def(lv, acc);
            else if (lv.type === 'list_literal')
                for (const v of this.listTargets(lv))
                    this.def(v, acc);
        }
        return acc.defCount() ? acc.finish() : undefined;
    }
    /** Facts for a `foreach ($it as [$k =>] $v)` head: targets bind, iterable used. */
    foreachHeadFacts(stmt) {
        const acc = new FactAccumulator(stmt.startPosition.row + 1);
        const iterable = stmt.namedChild(0);
        if (iterable)
            this.walkValue(iterable, acc);
        for (const v of this.foreachTargets(stmt))
            this.def(v, acc);
        return acc.finish();
    }
    /** ENTRY-block facts for the function's parameters (defs only). */
    paramFacts() {
        const acc = new FactAccumulator(this.fnNode.startPosition.row + 1);
        const params = this.fnNode.childForFieldName('parameters');
        if (params) {
            for (let i = 0; i < params.namedChildCount; i++) {
                const p = params.namedChild(i);
                if (!p)
                    continue;
                if (p.type !== 'simple_parameter' &&
                    p.type !== 'variadic_parameter' &&
                    p.type !== 'property_promotion_parameter') {
                    continue;
                }
                const varName = this.paramVarName(p);
                if (varName)
                    this.def(varName, acc);
            }
        }
        // A closure's `use (...)` captures are live on entry too — model as defs.
        if (this.fnNode.type === 'anonymous_function') {
            const clause = this.fnNode.namedChildren.find((c) => c.type === 'anonymous_function_use_clause');
            if (clause)
                for (const v of this.useClauseVars(clause))
                    this.def(v, acc);
        }
        return acc.defCount() ? acc.finish() : undefined;
    }
    /** Def fact for a `catch (T $e)` parameter — prepend to the handler entry block. */
    catchParamFacts(catchClause) {
        const name = catchClause.childForFieldName('name');
        if (!name || name.type !== 'variable_name')
            return undefined;
        const acc = new FactAccumulator(catchClause.startPosition.row + 1);
        this.def(name, acc);
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
        if (this.conditionalDepth > 0)
            acc.addMayDef(this.resolve(nameNode));
        else
            acc.addDef(this.resolve(nameNode));
    }
    use(nameNode, acc) {
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
    /** Strip parenthesized wrappers around an lvalue (`($x) = 1`). */
    unwrapParen(node) {
        let n = node;
        let hops = 8;
        while (n.type === 'parenthesized_expression' && hops-- > 0) {
            const inner = n.namedChildren.find((c) => c.type !== 'comment');
            if (!inner)
                break;
            n = inner;
        }
        return n;
    }
    /** Value-position walk: collect uses; route def positions to the lvalue handler. */
    walkValue(node, acc) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId) {
            // Opaque nested function / closure — captured reads/writes are invisible.
            return;
        }
        switch (t) {
            case 'variable_name':
                this.use(node, acc);
                return;
            case 'assignment_expression': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                if (left) {
                    const lv = this.unwrapParen(left);
                    if (lv.type === 'variable_name') {
                        const snap = acc.defSnapshot();
                        this.def(lv, acc);
                        if (right)
                            this.registerResultDefs(right, acc.defsSince(snap));
                    }
                    else if (lv.type === 'list_literal') {
                        // Destructure: every target binds; non-variable keys are uses.
                        for (const v of this.listTargets(lv))
                            this.def(v, acc);
                    }
                    else {
                        this.walkValue(lv, acc); // member / subscript target — uses only
                    }
                }
                if (right)
                    this.walkValue(right, acc);
                return;
            }
            case 'augmented_assignment_expression': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                if (left) {
                    const lv = this.unwrapParen(left);
                    if (lv.type === 'variable_name') {
                        this.def(lv, acc);
                        this.use(lv, acc); // compound assign reads too
                    }
                    else {
                        this.walkValue(lv, acc);
                    }
                }
                if (right)
                    this.walkValue(right, acc);
                return;
            }
            case 'update_expression': {
                const arg = node.childForFieldName('argument');
                const lv = arg ? this.unwrapParen(arg) : null;
                if (lv?.type === 'variable_name') {
                    this.def(lv, acc);
                    this.use(lv, acc);
                }
                else if (arg) {
                    this.walkValue(arg, acc);
                }
                return;
            }
            case 'binary_expression': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                const op = node.childForFieldName('operator')?.text ?? '';
                if (left)
                    this.walkValue(left, acc);
                if (right) {
                    if (op === '&&' || op === '||' || op === '??' || op === 'and' || op === 'or') {
                        this.conditional(() => this.walkValue(right, acc));
                    }
                    else {
                        this.walkValue(right, acc);
                    }
                }
                return;
            }
            case 'conditional_expression': {
                const cond = node.childForFieldName('condition');
                const body = node.childForFieldName('body');
                const alt = node.childForFieldName('alternative');
                if (cond)
                    this.walkValue(cond, acc);
                if (body)
                    this.conditional(() => this.walkValue(body, acc));
                if (alt)
                    this.conditional(() => this.walkValue(alt, acc));
                return;
            }
            case 'function_call_expression':
                this.visitCall(node, acc, 'function');
                return;
            case 'member_call_expression':
            case 'nullsafe_member_call_expression':
                this.visitCall(node, acc, 'member');
                return;
            case 'scoped_call_expression':
                this.visitCall(node, acc, 'scoped');
                return;
            case 'object_creation_expression':
                this.visitNew(node, acc);
                return;
            case 'member_access_expression':
            case 'nullsafe_member_access_expression': {
                // `$o->p` — value read of the object root only (the property name is not
                // a scalar binding); record the innermost identifier-rooted member read.
                this.walkChain(node, acc);
                return;
            }
            default:
                for (let i = 0; i < node.namedChildCount; i++) {
                    const c = node.namedChild(i);
                    if (c)
                        this.walkValue(c, acc);
                }
        }
    }
    // ── taint-site harvest ───────────────────────────────────────────────────
    /**
     * When `value`'s root (after stripping parens) is a call / object-creation
     * node, remember its site should carry `resultDefs: defs`.
     */
    registerResultDefs(value, defs) {
        if (defs.length === 0)
            return;
        const root = this.unwrapParen(value);
        if (root.type === 'function_call_expression' ||
            root.type === 'member_call_expression' ||
            root.type === 'nullsafe_member_call_expression' ||
            root.type === 'scoped_call_expression' ||
            root.type === 'object_creation_expression') {
            this.resultDefTargets.set(root.id, [...defs]);
        }
    }
    /**
     * Call-site handler for the three PHP call shapes:
     *  - `function`: `function_call_expression` (`function` field = name, no receiver)
     *  - `member`:   `member_call_expression` (`object` receiver, `name` method)
     *  - `scoped`:   `scoped_call_expression` (`scope` class, `name` method)
     * Reproduces the same uses the default descent recorded plus the call site.
     */
    visitCall(node, acc, shape) {
        const argsNode = node.childForFieldName('arguments');
        // `node` IS the call expression — the SAME node the scope-extractor anchors
        // `@reference.call.*` (its `atRange`) on (KTD7).
        const siteIdx = acc.openCallSite('call', [
            node.startPosition.row + 1,
            node.startPosition.column,
        ]);
        acc.pushFrame(siteIdx);
        if (shape === 'function') {
            const fnNode = node.childForFieldName('function');
            if (fnNode) {
                if (fnNode.type === 'name' || fnNode.type === 'qualified_name') {
                    acc.setSiteCallee(siteIdx, fnNode.text);
                }
                else {
                    // dynamic callee (`$fn()`, `($obj->cb)()`) — record uses, no static path
                    this.walkValue(fnNode, acc);
                }
            }
        }
        else if (shape === 'member') {
            const objectNode = node.childForFieldName('object');
            const nameNode = node.childForFieldName('name');
            let receiverPath;
            if (objectNode) {
                const chain = this.walkChain(objectNode, acc);
                receiverPath = chain.path;
                if (chain.rootIdx !== undefined)
                    acc.setSiteReceiver(siteIdx, chain.rootIdx);
            }
            if (nameNode && nameNode.type === 'name') {
                const callee = receiverPath !== undefined ? `${receiverPath}.${nameNode.text}` : nameNode.text;
                acc.setSiteCallee(siteIdx, callee);
            }
        }
        else {
            // scoped: `C::method(...)` — scope is a class name (not a binding).
            const scopeNode = node.childForFieldName('scope');
            const nameNode = node.childForFieldName('name');
            const scopeText = scopeNode && (scopeNode.type === 'name' || scopeNode.type === 'qualified_name')
                ? scopeNode.text
                : undefined;
            if (nameNode && nameNode.type === 'name') {
                const callee = scopeText !== undefined ? `${scopeText}.${nameNode.text}` : nameNode.text;
                acc.setSiteCallee(siteIdx, callee);
            }
        }
        const resultDefs = this.resultDefTargets.get(node.id);
        if (resultDefs !== undefined)
            acc.setSiteResultDefs(siteIdx, resultDefs);
        this.walkArgs(argsNode, acc);
        acc.popFrame();
    }
    /** Explicit `object_creation_expression` (`new Foo($x)`) handler. */
    visitNew(node, acc) {
        const argsNode = node.childForFieldName('arguments');
        // `node` IS the object_creation_expression — the SAME node the
        // scope-extractor anchors `@reference.call.constructor` (its `atRange`) on.
        const siteIdx = acc.openCallSite('new', [
            node.startPosition.row + 1,
            node.startPosition.column,
        ]);
        acc.pushFrame(siteIdx);
        // The class name is the first `name`/`qualified_name` child (not a binding).
        const className = node.namedChildren.find((c) => c.type === 'name' || c.type === 'qualified_name');
        if (className)
            acc.setSiteCallee(siteIdx, className.text.replace(/\s+/g, ''));
        const resultDefs = this.resultDefTargets.get(node.id);
        if (resultDefs !== undefined)
            acc.setSiteResultDefs(siteIdx, resultDefs);
        this.walkArgs(argsNode, acc);
        acc.popFrame();
    }
    /** Walk an `arguments` node, tagging each positional `argument` for occurrences. */
    walkArgs(argsNode, acc) {
        if (!argsNode)
            return;
        let pos = 0;
        for (let i = 0; i < argsNode.namedChildCount; i++) {
            const arg = argsNode.namedChild(i);
            if (!arg || arg.type === 'comment')
                continue;
            if (arg.type !== 'argument') {
                // A spread (`...$xs`) or other non-`argument` child — still walk for uses.
                this.walkValue(arg, acc);
                continue;
            }
            acc.setFrameArg(pos);
            this.walkValue(arg, acc);
            pos++;
        }
    }
    /**
     * Member-access chain walk shared by value position and a method-call receiver.
     * Records the chain-root `variable_name` as a use plus at most ONE member-read
     * site — the innermost access — when the root is a variable.
     */
    walkChain(node, acc) {
        const accesses = [];
        let cur = this.unwrapParen(node);
        for (;;) {
            if (cur.type === 'member_access_expression' ||
                cur.type === 'nullsafe_member_access_expression') {
                const field = cur.childForFieldName('name');
                accesses.unshift(field?.text ?? '');
                const obj = cur.childForFieldName('object');
                if (!obj)
                    break;
                cur = this.unwrapParen(obj);
            }
            else {
                break;
            }
        }
        let rootIdx;
        let rootSegment;
        if (cur.type === 'variable_name') {
            rootIdx = this.resolve(cur);
            acc.addUse(rootIdx);
            rootSegment = cur.text;
        }
        else {
            this.walkValue(cur, acc);
        }
        const innermost = accesses[0];
        if (rootIdx !== undefined && innermost)
            acc.addMemberRead(rootIdx, innermost);
        const path = rootSegment !== undefined && accesses.every((a) => a !== '')
            ? [rootSegment, ...accesses].join('.')
            : undefined;
        return { path, rootIdx };
    }
}
/**
 * Ordered, deduplicating def/use + call-site collector for one statement record.
 * The shared {@link CallSiteFactAccumulator} carries the def/use machinery plus
 * the taint-site harvest.
 */
const FactAccumulator = CallSiteFactAccumulator;
