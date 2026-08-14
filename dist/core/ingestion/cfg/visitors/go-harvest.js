import { CallSiteFactAccumulator, finalizeChain } from './call-site-harvest.js';
import { ScopeTreeHarvester } from './scope-tree-harvest.js';
/** Node types that own a nested CFG — their subtrees are opaque to harvesting. */
const NESTED_FUNCTION_TYPES = new Set([
    'func_literal',
    'function_declaration',
    'method_declaration',
]);
/**
 * Nodes that open a lexical scope for block-local declarations. A `block` is one
 * scope; the loop / branch constructs open a scope for their init / loop var; a
 * switch/select case scopes its case-local declarations.
 */
const SCOPE_TYPES = new Set([
    'block',
    'for_statement',
    'if_statement',
    'expression_switch_statement',
    'type_switch_statement',
    'select_statement',
    'expression_case',
    'type_case',
    'default_case',
    'communication_case',
]);
export class GoHarvester extends ScopeTreeHarvester {
    constructor(fnNode) {
        super(fnNode);
        this.declareReceiver(fnNode);
        this.declareParams(fnNode);
        const body = this.bodyOf(fnNode);
        if (body && body.type === 'block')
            this.prescan(body, this.openScope(body));
    }
    /** The function/method/literal body node (always a `block` in Go). */
    bodyOf(fnNode) {
        return fnNode.childForFieldName('body') ?? undefined;
    }
    // ── phase 1: declaration pre-scan ────────────────────────────────────────
    /** Go override: `_` is the blank identifier and binds nothing. */
    declare(nameNode, kind, scope) {
        const name = nameNode.text;
        if (!name || name === '_' || scope.table.has(name))
            return; // `_` is the blank identifier
        scope.table.set(name, this.bindings.length);
        this.bindings.push({
            name,
            declLine: nameNode.startPosition.row + 1,
            declColumn: nameNode.startPosition.column,
            kind,
        });
    }
    /** Method receiver: `func (r *T) M()` — `r` binds at function scope. */
    declareReceiver(fnNode) {
        const recv = fnNode.childForFieldName('receiver');
        if (!recv)
            return;
        for (let i = 0; i < recv.namedChildCount; i++) {
            const p = recv.namedChild(i);
            if (p?.type !== 'parameter_declaration')
                continue;
            const name = p.childForFieldName('name');
            if (name)
                this.declare(name, 'param', this.root);
        }
    }
    declareParams(fnNode) {
        const params = fnNode.childForFieldName('parameters');
        if (!params)
            return;
        for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i);
            if (p?.type !== 'parameter_declaration' && p?.type !== 'variadic_parameter_declaration') {
                continue;
            }
            // A single `parameter_declaration` can name several params: `a, b int`.
            for (let j = 0; j < p.namedChildCount; j++) {
                const c = p.namedChild(j);
                if (c?.type === 'identifier')
                    this.declare(c, 'param', this.root);
            }
        }
    }
    prescan(node, scope) {
        this.nearestScopeCache.set(node.id, scope);
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId) {
            // A nested function literal is opaque — do not descend.
            return;
        }
        let childScope = scope;
        if (SCOPE_TYPES.has(t))
            childScope = this.openScope(node);
        switch (t) {
            case 'short_var_declaration': {
                // `a, b := …` — every identifier on the left is a fresh binding.
                const left = node.childForFieldName('left');
                if (left)
                    this.declareIdentifiers(left, childScope);
                break;
            }
            case 'var_declaration':
                this.declareVarDeclaration(node, childScope);
                break;
            case 'range_clause': {
                // `for k, v := range xs` — the `:=` form binds the loop vars; the `=`
                // reassign form references existing names (not declared here).
                if (this.rangeIsShort(node)) {
                    const left = node.childForFieldName('left');
                    if (left)
                        this.declareIdentifiers(left, childScope);
                }
                break;
            }
            case 'type_switch_statement': {
                // `switch t := i.(type)` — `t` binds once for the whole switch (the
                // per-case narrowed `t` shares the name).
                const alias = node.childForFieldName('alias');
                if (alias)
                    this.declareIdentifiers(alias, childScope);
                break;
            }
            case 'receive_statement': {
                // `case v := <-ch` inside a select — the `:=` form binds `v`.
                if (this.receiveIsShort(node)) {
                    const left = node.childForFieldName('left');
                    if (left)
                        this.declareIdentifiers(left, childScope);
                }
                break;
            }
            default:
                break;
        }
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (c)
                this.prescan(c, childScope);
        }
    }
    /** Declare every identifier child of an `expression_list` (LHS of `:=`). */
    declareIdentifiers(list, scope) {
        for (let i = 0; i < list.namedChildCount; i++) {
            const c = list.namedChild(i);
            if (c?.type === 'identifier')
                this.declare(c, 'var', scope);
        }
    }
    /** Declare names of an INITIALIZED `var_spec` (a bare `var x int` writes nothing). */
    declareVarDeclaration(declNode, scope) {
        const specs = this.varSpecs(declNode);
        for (const spec of specs) {
            const hasValue = spec.childForFieldName('value') !== null;
            if (!hasValue)
                continue; // bare `var x int` — not a runtime write
            for (let i = 0; i < spec.namedChildCount; i++) {
                const c = spec.namedChild(i);
                if (c?.type === 'identifier')
                    this.declare(c, 'var', scope);
            }
        }
    }
    /** The `var_spec` nodes of a `var_declaration` (single or `var ( … )` block). */
    varSpecs(declNode) {
        const out = [];
        for (let i = 0; i < declNode.namedChildCount; i++) {
            const c = declNode.namedChild(i);
            if (!c)
                continue;
            if (c.type === 'var_spec')
                out.push(c);
            else if (c.type === 'var_spec_list') {
                for (let j = 0; j < c.namedChildCount; j++) {
                    const s = c.namedChild(j);
                    if (s?.type === 'var_spec')
                        out.push(s);
                }
            }
        }
        return out;
    }
    /** A `range_clause` is the `:=` short form iff it has no `=` operator token. */
    rangeIsShort(node) {
        return this.hasAnonChild(node, ':=');
    }
    /** A `receive_statement` (`case v := <-ch`) is the `:=` short form. */
    receiveIsShort(node) {
        return this.hasAnonChild(node, ':=');
    }
    hasAnonChild(node, text) {
        for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (c && !c.isNamed && c.text === text)
                return true;
        }
        return false;
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
     * Facts for a `for … range right` head: the `:=` loop vars are defs (the `=`
     * reassign form's vars are also written), and `right` is used.
     */
    rangeHeadFacts(rangeClause) {
        const acc = new FactAccumulator(rangeClause.startPosition.row + 1);
        const left = rangeClause.childForFieldName('left');
        const right = rangeClause.childForFieldName('right');
        if (left) {
            for (let i = 0; i < left.namedChildCount; i++) {
                const c = left.namedChild(i);
                if (c?.type === 'identifier')
                    this.def(c, acc);
                else if (c)
                    this.walkValue(c, acc);
            }
        }
        if (right)
            this.walkValue(right, acc);
        return acc.finish();
    }
    /**
     * Facts for a `switch t := i.(type)` head: `t` binds (a def) and the inspected
     * value is used.
     */
    typeSwitchHeadFacts(stmt) {
        const acc = new FactAccumulator(stmt.startPosition.row + 1);
        const alias = stmt.childForFieldName('alias');
        const value = stmt.childForFieldName('value');
        if (alias) {
            for (let i = 0; i < alias.namedChildCount; i++) {
                const c = alias.namedChild(i);
                if (c?.type === 'identifier')
                    this.def(c, acc);
            }
        }
        if (value)
            this.walkValue(value, acc);
        return acc.finish();
    }
    /** ENTRY-block facts for the receiver + parameters (defs only). */
    paramFacts() {
        const acc = new FactAccumulator(this.fnNode.startPosition.row + 1);
        const recv = this.fnNode.childForFieldName('receiver');
        if (recv) {
            for (let i = 0; i < recv.namedChildCount; i++) {
                const p = recv.namedChild(i);
                if (p?.type !== 'parameter_declaration')
                    continue;
                const name = p.childForFieldName('name');
                if (name)
                    this.def(name, acc);
            }
        }
        const params = this.fnNode.childForFieldName('parameters');
        if (params) {
            for (let i = 0; i < params.namedChildCount; i++) {
                const p = params.namedChild(i);
                if (p?.type !== 'parameter_declaration' && p?.type !== 'variadic_parameter_declaration') {
                    continue;
                }
                for (let j = 0; j < p.namedChildCount; j++) {
                    const c = p.namedChild(j);
                    if (c?.type === 'identifier')
                        this.def(c, acc);
                }
            }
        }
        return acc.defCount() ? acc.finish() : undefined;
    }
    /** Go override: the blank identifier (`_`) defines nothing. */
    def(nameNode, acc) {
        if (nameNode.text === '_')
            return; // blank identifier defines nothing
        if (this.conditionalDepth > 0)
            acc.addMayDef(this.resolve(nameNode));
        else
            acc.addDef(this.resolve(nameNode));
    }
    /** Go override: the blank identifier (`_`) is read of nothing. */
    use(nameNode, acc) {
        if (nameNode.text === '_')
            return;
        acc.addUse(this.resolve(nameNode));
    }
    /** Strip parenthesized wrappers around an lvalue (`(x) = 1`). */
    unwrapLvalue(node) {
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
    /** Def each identifier of an LHS `expression_list`; route non-identifiers to uses. */
    defLeftList(list, acc, alsoUse) {
        for (let i = 0; i < list.namedChildCount; i++) {
            const c = list.namedChild(i);
            if (!c)
                continue;
            const lv = this.unwrapLvalue(c);
            if (lv.type === 'identifier') {
                this.def(lv, acc);
                if (alsoUse)
                    this.use(lv, acc); // compound assign (`+=`) reads too
            }
            else {
                // selector / index / pointer-deref target — uses only (root identifier).
                this.walkValue(lv, acc);
            }
        }
    }
    /** Value-position walk: collect uses; route def positions to the lvalue handler. */
    walkValue(node, acc) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId) {
            // Opaque nested function literal — captured reads/writes are invisible.
            return;
        }
        switch (t) {
            case 'identifier':
                this.use(node, acc);
                return;
            case 'short_var_declaration': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                // Register result-defs BEFORE walking the value so the nested call site
                // (reached during the value walk) carries them — single-target only
                // (`x := f(a)`; a multi-target `a, b := f()` attaches nothing).
                if (left && right)
                    this.registerListResultDefs(left, right);
                if (right)
                    this.walkValue(right, acc);
                if (left) {
                    for (let i = 0; i < left.namedChildCount; i++) {
                        const c = left.namedChild(i);
                        if (c?.type === 'identifier')
                            this.def(c, acc);
                    }
                }
                return;
            }
            case 'var_declaration': {
                for (const spec of this.varSpecs(node)) {
                    const value = spec.childForFieldName('value');
                    if (value && this.singleSpecName(spec))
                        this.registerResultDefs(value, [spec]);
                    if (value)
                        this.walkValue(value, acc);
                    if (value) {
                        for (let i = 0; i < spec.namedChildCount; i++) {
                            const c = spec.namedChild(i);
                            if (c?.type === 'identifier')
                                this.def(c, acc);
                        }
                    }
                }
                return;
            }
            case 'assignment_statement': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                const op = node.childForFieldName('operator')?.text ?? '=';
                // Plain `x = f(a)` attaches `resultDefs: [x]`; a compound `x += f(a)`
                // does not (the prior value flows in too).
                if (op === '=' && left && right)
                    this.registerListResultDefs(left, right);
                if (right)
                    this.walkValue(right, acc);
                if (left)
                    this.defLeftList(left, acc, op !== '=');
                return;
            }
            case 'receive_statement': {
                // `select { case v := <-ch: }` / `case v = <-ch:` — the left
                // identifier(s) are DEFS of the channel-received value; `<-ch` (right)
                // is a use of the channel. A bare `case <-ch:` has no left (uses only).
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                const isShort = node.children.some((c) => !c.isNamed && c.text === ':=');
                if (isShort && left && right)
                    this.registerListResultDefs(left, right);
                if (right)
                    this.walkValue(right, acc);
                if (left)
                    this.defLeftList(left, acc, false);
                return;
            }
            case 'inc_statement':
            case 'dec_statement': {
                // `x++` / `x--` — def AND use the lvalue when it's a plain identifier.
                const operand = node.namedChild(0);
                const lv = operand ? this.unwrapLvalue(operand) : null;
                if (lv?.type === 'identifier') {
                    this.def(lv, acc);
                    this.use(lv, acc);
                }
                else if (operand) {
                    this.walkValue(operand, acc);
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
                    if (op === '&&' || op === '||')
                        this.conditional(() => this.walkValue(right, acc));
                    else
                        this.walkValue(right, acc);
                }
                return;
            }
            case 'call_expression':
                // #2195 U6: explicit case (previously default-descended) — same uses,
                // plus a taint-site record. Go has no `new` (constructor calls are plain
                // `call_expression`s). Defs/uses stay byte-identical.
                this.visitCall(node, acc);
                return;
            case 'selector_expression': {
                // `a.b` — value read of the operand root only; the field name is not a
                // scalar binding. Mirrors the TS member-read use semantics, plus a
                // member-read site for the innermost identifier-rooted access.
                this.walkChain(node, acc, false);
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
    // ── taint-site harvest (#2195 U6) ────────────────────────────────────────
    /** The single `var_spec` name when the spec declares exactly one name, else undefined. */
    singleSpecName(spec) {
        const names = [];
        for (let i = 0; i < spec.namedChildCount; i++) {
            const c = spec.namedChild(i);
            if (c?.type === 'identifier')
                names.push(c);
        }
        return names.length === 1 ? names[0] : undefined;
    }
    /**
     * Register result-defs for a single-target LHS `expression_list` → RHS
     * `expression_list` whose sole element is a call. `a, b := f()` (multi-target)
     * and `x, y := f(), g()` attach nothing — the per-target mapping is ambiguous,
     * matching the TS harvester's per-declarator restriction.
     */
    registerListResultDefs(left, right) {
        const leftNames = this.listIdentifiers(left);
        const rightVals = this.listElements(right);
        if (leftNames.length !== 1 || rightVals.length !== 1)
            return;
        this.registerResultDefs(rightVals[0], [leftNames[0]]);
    }
    /** Identifier elements of an `expression_list` (`a, b` ⇒ [a, b]). */
    listIdentifiers(list) {
        const out = [];
        for (let i = 0; i < list.namedChildCount; i++) {
            const c = list.namedChild(i);
            if (c?.type === 'identifier')
                out.push(c);
        }
        return out;
    }
    /** Named elements of an `expression_list` (or the node itself if not a list). */
    listElements(list) {
        if (list.type !== 'expression_list')
            return [list];
        const out = [];
        for (let i = 0; i < list.namedChildCount; i++) {
            const c = list.namedChild(i);
            if (c)
                out.push(c);
        }
        return out;
    }
    /**
     * When `value`'s root (after stripping parens) is a call, remember its site
     * should carry `resultDefs` — the binding indices of `targets` (def-position
     * identifiers, resolved against the completed scope tree). Consumed by
     * {@link visitCall} once the value walk reaches the node.
     */
    registerResultDefs(value, targets) {
        const root = this.unwrapLvalue(value);
        if (root.type !== 'call_expression')
            return;
        const defs = [];
        for (const target of targets) {
            // A `var_spec` carries its name(s) as children; an identifier resolves
            // directly. Skip the blank identifier (`_`), which binds nothing.
            const names = target.type === 'identifier' ? [target] : this.listIdentifiers(target);
            for (const n of names) {
                if (n.text === '_')
                    continue;
                defs.push(this.resolve(n));
            }
        }
        if (defs.length > 0)
            this.resultDefTargets.set(root.id, defs);
    }
    /**
     * Explicit `call_expression` handler. Records a call site (callee path,
     * receiver, per-arg occurrence entries, result defs) while reproducing EXACTLY
     * the uses the old default descent recorded (callee chain root + arguments).
     */
    visitCall(node, acc) {
        const calleeNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');
        // `node` IS the call_expression — the SAME node the scope-extractor anchors
        // `@reference.call.*` (its `atRange`) on (KTD7).
        const siteIdx = acc.openCallSite('call', [
            node.startPosition.row + 1,
            node.startPosition.column,
        ]);
        acc.pushFrame(siteIdx);
        let calleePath;
        if (calleeNode) {
            const callee = this.unwrapLvalue(calleeNode);
            if (callee.type === 'identifier') {
                if (callee.text !== '_')
                    acc.addUseWithoutOccurrence(this.resolve(callee));
                calleePath = callee.text;
            }
            else if (callee.type === 'selector_expression') {
                // skipFinalRead: the final `.field` IS the callee, carried by the path.
                const chain = this.walkChain(callee, acc, true);
                calleePath = chain.path;
                if (chain.rootIdx !== undefined)
                    acc.setSiteReceiver(siteIdx, chain.rootIdx);
            }
            else {
                // Call-rooted chains, conversions (`T(x)`), parenthesized funcs — the
                // walk still records uses and nested sites.
                this.walkValue(callee, acc);
            }
            if (calleePath !== undefined)
                acc.setSiteCallee(siteIdx, calleePath);
        }
        const resultDefs = this.resultDefTargets.get(node.id);
        if (resultDefs !== undefined)
            acc.setSiteResultDefs(siteIdx, resultDefs);
        if (argsNode) {
            let pos = 0;
            for (let i = 0; i < argsNode.namedChildCount; i++) {
                const arg = argsNode.namedChild(i);
                if (!arg || arg.type === 'comment')
                    continue;
                // `f(xs...)` — a variadic spread. Mark the first spread position so the
                // matcher degrades soundly; the inner value still walks for occurrences.
                if (arg.type === 'variadic_argument') {
                    acc.setFrameArg(pos);
                    acc.setSiteSpread(siteIdx, pos);
                    const inner = arg.namedChild(0);
                    if (inner)
                        this.walkValue(inner, acc);
                }
                else {
                    acc.setFrameArg(pos);
                    this.walkValue(arg, acc);
                }
                pos++;
            }
        }
        acc.popFrame();
    }
    /**
     * `selector_expression` chain walk shared by value position and callee
     * position. Records the chain-root identifier as a use (identical to the old
     * default descent) plus at most ONE member-read site — the INNERMOST access —
     * when the root is an identifier; `skipFinalRead` suppresses it when that
     * access is the callee (carried by the dotted path instead).
     */
    walkChain(node, acc, skipFinalRead) {
        const accesses = [];
        let cur = this.unwrapLvalue(node);
        for (;;) {
            if (cur.type === 'selector_expression') {
                const field = cur.childForFieldName('field');
                accesses.unshift(field?.text ?? '');
                const operand = cur.childForFieldName('operand');
                if (!operand)
                    break;
                cur = this.unwrapLvalue(operand);
            }
            else {
                break;
            }
        }
        // The shared terminal: root-use record + innermost member-read + path-join.
        return finalizeChain(acc, cur, accesses, skipFinalRead, (t) => t === 'identifier', {
            resolve: (n) => this.resolve(n),
            walkRoot: (n) => this.walkValue(n, acc),
        });
    }
}
/**
 * Ordered, deduplicating def/use + call-site collector for one statement record.
 * The shared {@link CallSiteFactAccumulator} carries the def/use machinery the
 * old local class had, plus the taint-site harvest (#2195 U6).
 */
const FactAccumulator = CallSiteFactAccumulator;
