/** Node types that own a nested CFG — their subtrees are opaque to harvesting. */
const NESTED_FUNCTION_TYPES = new Set([
    'function_declaration',
    'function_expression',
    'arrow_function',
    'method_definition',
    'generator_function_declaration',
    'generator_function',
    'async_function_declaration',
    'async_arrow_function',
]);
/** Function-ish declaration statements whose NAME still binds in the enclosing scope. */
const FUNCTION_DECL_TYPES = new Set([
    'function_declaration',
    'generator_function_declaration',
    'async_function_declaration',
]);
/**
 * Nodes that open a lexical scope for `let`/`const`/`class`/catch bindings.
 * A `switch` BODY is deliberately ONE scope shared by all case arms (JS
 * semantics: `case 1: let x = 1; case 2: use(x)` is the same binding).
 */
const SCOPE_TYPES = new Set([
    'statement_block',
    'for_statement',
    'for_in_statement',
    'for_of_statement',
    'catch_clause',
    'switch_body',
]);
/** Type-position subtrees — identifiers inside them are not value uses. */
const TYPE_CONTEXT_TYPES = new Set([
    'type_annotation',
    'type_arguments',
    'type_parameters',
    'type_predicate_annotation',
    'asserts_annotation',
]);
/**
 * Wrappers that don't change which VALUE flows through them (#2083 M3 U1) —
 * unwrapped when resolving call-result attribution (`const b = (await
 * escape(t))!` still attaches `resultDefs: [b]` to the escape site) and
 * member-chain roots. Distinct from {@link TsHarvester.unwrapLvalue}, which is
 * the narrower LVALUE set.
 */
const VALUE_WRAPPER_TYPES = new Set([
    'parenthesized_expression',
    'non_null_expression',
    'as_expression',
    'satisfies_expression',
    'await_expression',
]);
/** Literal text of a `string` node (concatenated fragments; raw escapes kept). */
const stringLiteralText = (node) => {
    let out = '';
    for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c?.type === 'string_fragment' || c?.type === 'escape_sequence')
            out += c.text;
    }
    return out;
};
export class TsHarvester {
    fnNode;
    bindings = [];
    /** Scope-opening node id → its scope. */
    scopeByNode = new Map();
    root = { parent: null, table: new Map() };
    /** name → synthetic binding index (implicit global / import / captured). */
    synthetic = new Map();
    fnId;
    /**
     * Innermost enclosing scope per visited node id, filled during the prescan
     * (which already touches every named node once). Makes phase-2 resolution
     * O(scope-chain) instead of O(AST-depth) per identifier — a deeply-chained
     * single-statement expression (generated code) otherwise turns the
     * parent-chain walk quadratic (tri-review perf finding).
     */
    nearestScopeCache = new Map();
    /**
     * >0 while walking a conditionally-evaluated subexpression (short-circuit
     * right operand, ternary arm, logical-assignment target, case test). Defs
     * found there are MAY-defs — gen without kill (tri-review P1: a must-def
     * here falsely kills the prior def on the not-taken path).
     */
    conditionalDepth = 0;
    /**
     * Call/new node id → bindings whose declarator/assignment VALUE is exactly
     * that call (#2083 M3 U1). Registered by the declarator/assignment handlers
     * BEFORE the value walk, consumed by {@link visitCall} when it reaches the
     * node — the indirection keeps result-def attribution per-declarator
     * (`const a = t, b = escape(t)` attaches `[b]` to the escape site only) and
     * top-level-only (`const c = cond ? escape(b) : b` attaches nothing — the
     * bypass occurrence must keep `c` taintable, plan KTD4a).
     */
    resultDefTargets = new Map();
    constructor(fnNode) {
        this.fnNode = fnNode;
        this.fnId = fnNode.id;
        this.scopeByNode.set(fnNode.id, this.root);
        this.declareParams(fnNode);
        const body = fnNode.childForFieldName('body');
        if (body)
            this.prescan(body, body.type === 'statement_block' ? this.openScope(body) : this.root);
    }
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    table() {
        return this.bindings;
    }
    // ── phase 1: declaration pre-scan ────────────────────────────────────────
    openScope(node) {
        const existing = this.scopeByNode.get(node.id);
        if (existing)
            return existing;
        const scope = { parent: this.nearestScopeOf(node), table: new Map() };
        this.scopeByNode.set(node.id, scope);
        return scope;
    }
    nearestScopeOf(node) {
        for (let p = node.parent; p; p = p.parent) {
            const s = this.scopeByNode.get(p.id);
            if (s)
                return s;
            if (p.id === this.fnId)
                break;
        }
        return this.root;
    }
    declare(nameNode, kind, scope, hoistToRoot, formalIndex) {
        const target = hoistToRoot ? this.root : scope;
        const name = nameNode.text;
        // `var` multi-declaration (and a param + `var` of the same name) is ONE
        // binding — first declaration in source order is canonical. The dedup is
        // scoped to the single target table, so an inner `let x` shadowing a root
        // `var x` still gets its own entry in its own scope.
        if (target.table.has(name))
            return;
        target.table.set(name, this.bindings.length);
        this.bindings.push({
            name,
            declLine: nameNode.startPosition.row + 1,
            declColumn: nameNode.startPosition.column,
            kind,
            // Carry the enclosing formal position for params so the PDG call-summary
            // consumer joins by FORMAL slot, never the flattened binding ordinal. A
            // destructured/rest formal hands the SAME index to every inner name.
            ...(formalIndex !== undefined ? { formalIndex } : {}),
        });
    }
    declareParams(fnNode) {
        const params = fnNode.childForFieldName('parameters') ?? fnNode.childForFieldName('parameter');
        if (!params)
            return;
        if (params.type === 'identifier') {
            this.declare(params, 'param', this.root, true, 0); // `x => …` single-param arrow ⇒ formal 0
            return;
        }
        // Each NAMED child of the parameter list is one top-level formal — its index
        // here is the 0-based formal position. Destructured/rest formals fan out to
        // several inner names, but ALL inherit this one formal index, so the PDG
        // call-summary never misattributes an inner name to a later formal's slot.
        let formalIndex = 0;
        for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i);
            if (!p)
                continue;
            // TS wraps each param (required_parameter/optional_parameter, field
            // `pattern`); plain JS puts the pattern directly in formal_parameters.
            const pattern = p.childForFieldName('pattern') ?? p;
            this.declarePattern(pattern, 'param', this.root, true, formalIndex);
            formalIndex++;
        }
    }
    /**
     * Declare every name bound by a (possibly destructuring) pattern. When
     * `formalIndex` is supplied (param patterns), EVERY name the pattern binds
     * carries that one enclosing-formal position (the recursion never reassigns
     * it), so `function f({a, b}, c)` records a:0, b:0, c:1.
     */
    declarePattern(node, kind, scope, hoistToRoot, formalIndex) {
        switch (node.type) {
            case 'identifier':
            case 'shorthand_property_identifier_pattern':
                this.declare(node, kind, scope, hoistToRoot, formalIndex);
                return;
            case 'rest_pattern':
            case 'object_pattern':
            case 'array_pattern':
                for (let i = 0; i < node.namedChildCount; i++) {
                    const c = node.namedChild(i);
                    if (c)
                        this.declarePattern(c, kind, scope, hoistToRoot, formalIndex);
                }
                return;
            case 'pair_pattern': {
                const value = node.childForFieldName('value');
                if (value)
                    this.declarePattern(value, kind, scope, hoistToRoot, formalIndex);
                return;
            }
            case 'assignment_pattern':
            case 'object_assignment_pattern': {
                const left = node.childForFieldName('left');
                if (left)
                    this.declarePattern(left, kind, scope, hoistToRoot, formalIndex);
                return;
            }
            default:
                // Type annotations / unknown wrappers — descend defensively.
                for (let i = 0; i < node.namedChildCount; i++) {
                    const c = node.namedChild(i);
                    if (c && !TYPE_CONTEXT_TYPES.has(c.type)) {
                        this.declarePattern(c, kind, scope, hoistToRoot, formalIndex);
                    }
                }
        }
    }
    prescan(node, scope) {
        this.nearestScopeCache.set(node.id, scope);
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId) {
            // A nested function's NAME binds in the enclosing scope; its body is opaque.
            if (FUNCTION_DECL_TYPES.has(t)) {
                const name = node.childForFieldName('name');
                if (name)
                    this.declare(name, 'function', scope, false);
            }
            return;
        }
        let childScope = scope;
        if (SCOPE_TYPES.has(t))
            childScope = this.openScope(node);
        switch (t) {
            case 'lexical_declaration': {
                const kind = node.child(0)?.type === 'const' ? 'const' : 'let';
                this.declareDeclarators(node, kind, childScope, false);
                break;
            }
            case 'variable_declaration':
                this.declareDeclarators(node, 'var', childScope, true);
                break;
            case 'class_declaration': {
                const name = node.childForFieldName('name');
                if (name)
                    this.declare(name, 'class', childScope, false);
                break;
            }
            case 'catch_clause': {
                const param = node.childForFieldName('parameter');
                if (param)
                    this.declarePattern(param, 'catch', childScope, false);
                break;
            }
            case 'for_in_statement':
            case 'for_of_statement': {
                // `for (const x of xs)` — the `kind` keyword marks a declaration; a bare
                // `for (x of xs)` left is an assignment, resolved at use time instead.
                const kindNode = node.childForFieldName('kind');
                const left = node.childForFieldName('left');
                if (kindNode && left) {
                    const k = kindNode.type === 'var' ? 'var' : kindNode.type === 'const' ? 'const' : 'let';
                    this.declarePattern(left, k, childScope, k === 'var');
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
    declareDeclarators(declNode, kind, scope, hoistToRoot) {
        for (let i = 0; i < declNode.namedChildCount; i++) {
            const d = declNode.namedChild(i);
            if (d?.type !== 'variable_declarator')
                continue;
            const name = d.childForFieldName('name');
            if (name)
                this.declarePattern(name, kind, scope, hoistToRoot);
        }
    }
    // ── phase 2: per-statement fact extraction ───────────────────────────────
    /**
     * Def/use facts for one statement (or construct-header expression) node.
     * Safe from any walk order — resolution consults the completed scope tree.
     */
    facts(node) {
        const acc = new FactAccumulator(node.startPosition.row + 1);
        this.walkValue(node, acc);
        return acc.finish();
    }
    /**
     * Facts for an expression whose WHOLE evaluation is conditional (switch
     * case tests, which only run when earlier cases didn't match) — every def
     * inside becomes a may-def.
     */
    factsConditional(node) {
        const acc = new FactAccumulator(node.startPosition.row + 1);
        this.conditional(() => this.walkValue(node, acc));
        return acc.finish();
    }
    /** Facts for a `for (left in/of right)` head: left binds/assigns, right is used. */
    forInHeadFacts(stmt) {
        const acc = new FactAccumulator(stmt.startPosition.row + 1);
        const left = stmt.childForFieldName('left');
        const right = stmt.childForFieldName('right');
        if (left)
            this.walkDefPattern(left, acc);
        if (right)
            this.walkValue(right, acc);
        return acc.finish();
    }
    /** ENTRY-block facts for the function's parameters (defs + default-value uses). */
    paramFacts() {
        const fnNode = this.fnNode;
        const params = fnNode.childForFieldName('parameters') ?? fnNode.childForFieldName('parameter');
        if (!params)
            return undefined;
        const acc = new FactAccumulator(fnNode.startPosition.row + 1);
        if (params.type === 'identifier') {
            this.def(params, acc);
        }
        else {
            for (let i = 0; i < params.namedChildCount; i++) {
                const p = params.namedChild(i);
                if (!p)
                    continue;
                const pattern = p.childForFieldName('pattern') ?? p;
                this.walkDefPattern(pattern, acc);
                const dflt = p.childForFieldName('value');
                if (dflt)
                    this.walkValue(dflt, acc);
            }
        }
        return acc.defCount() || acc.useCount() ? acc.finish() : undefined;
    }
    /** Def fact for a `catch (e)` parameter — prepend to the handler entry block. */
    catchParamFacts(catchClause) {
        const param = catchClause.childForFieldName('parameter');
        if (!param)
            return undefined;
        const acc = new FactAccumulator(catchClause.startPosition.row + 1);
        this.walkDefPattern(param, acc);
        return acc.defCount() ? acc.finish() : undefined;
    }
    resolve(nameNode) {
        const name = nameNode.text;
        // Fast path: the prescan cached every visited node's innermost scope, so
        // resolution walks the SCOPE chain (shallow), not the AST parent chain
        // (arbitrarily deep in chained expressions). The parent-chain walk remains
        // as fallback for the few nodes the prescan never visits (e.g. a nested
        // function declaration's own name node).
        const cached = this.nearestScopeCache.get(nameNode.id);
        let startScope = cached ?? null;
        if (!startScope) {
            for (let p = nameNode; p; p = p.parent) {
                const scope = this.scopeByNode.get(p.id) ?? this.nearestScopeCache.get(p.id);
                if (scope) {
                    startScope = scope;
                    break;
                }
                if (p.id === this.fnId) {
                    startScope = this.root;
                    break;
                }
            }
        }
        for (let s = startScope; s; s = s.parent) {
            const idx = s.table.get(name);
            if (idx !== undefined)
                return idx;
        }
        // No in-function declaration — synthetic module-level binding, shared by
        // defs and uses so `notDeclared = 1; use(notDeclared)` still forms a fact.
        let idx = this.synthetic.get(name);
        if (idx === undefined) {
            idx = this.bindings.length;
            this.synthetic.set(name, idx);
            this.bindings.push({ name, declLine: 0, declColumn: 0, kind: 'module', synthetic: true });
        }
        return idx;
    }
    def(nameNode, acc) {
        if (this.conditionalDepth > 0)
            acc.addMayDef(this.resolve(nameNode));
        else
            acc.addDef(this.resolve(nameNode));
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
    /** Strip wrappers that don't change the lvalue (`(x) += 1`, `x! ++`). */
    unwrapLvalue(node) {
        let n = node;
        while (n.type === 'parenthesized_expression' || n.type === 'non_null_expression') {
            const inner = n.namedChild(0);
            if (!inner)
                break;
            n = inner;
        }
        return n;
    }
    use(nameNode, acc) {
        acc.addUse(this.resolve(nameNode));
    }
    /** Value-position walk: collect uses; route def positions to the pattern walk. */
    walkValue(node, acc) {
        const t = node.type;
        if (TYPE_CONTEXT_TYPES.has(t))
            return;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId) {
            // Opaque nested function: its NAME (function declaration) is a def in
            // the enclosing scope; captured reads/writes inside are invisible (KTD4).
            if (FUNCTION_DECL_TYPES.has(t)) {
                const name = node.childForFieldName('name');
                if (name)
                    this.def(name, acc);
            }
            return;
        }
        switch (t) {
            case 'identifier':
            case 'shorthand_property_identifier':
                this.use(node, acc);
                return;
            case 'lexical_declaration':
            case 'variable_declaration':
                for (let i = 0; i < node.namedChildCount; i++) {
                    const d = node.namedChild(i);
                    if (d?.type !== 'variable_declarator')
                        continue;
                    const name = d.childForFieldName('name');
                    const value = d.childForFieldName('value');
                    // A bare `var x;` mid-function is hoisted and writes NOTHING at
                    // runtime — harvesting it as a def would fabricate a kill of the
                    // live def (`x = source(); var x; sink(x)` must keep source→sink;
                    // tri-review P2). `let`/`const` declarators genuinely initialize.
                    if (name && (value || t === 'lexical_declaration')) {
                        const snap = acc.defSnapshot();
                        this.walkDefPattern(name, acc);
                        if (value)
                            this.registerResultDefs(value, acc.defsSince(snap));
                    }
                    if (value)
                        this.walkValue(value, acc);
                }
                return;
            case 'assignment_expression': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                if (left) {
                    const snap = acc.defSnapshot();
                    this.walkDefPattern(this.unwrapLvalue(left), acc);
                    if (right)
                        this.registerResultDefs(right, acc.defsSince(snap));
                }
                if (right)
                    this.walkValue(right, acc);
                return;
            }
            case 'augmented_assignment_expression': {
                // `x += y` both defines and uses x. The logical-assignment operators
                // (`||=`, `&&=`, `??=`) only WRITE conditionally — their def is a
                // may-def (the read always happens).
                const left = node.childForFieldName('left')
                    ? this.unwrapLvalue(node.childForFieldName('left'))
                    : null;
                const right = node.childForFieldName('right');
                const op = node.childForFieldName('operator')?.type ?? '';
                const logical = op === '||=' || op === '&&=' || op === '??=';
                if (left?.type === 'identifier') {
                    if (logical)
                        this.conditional(() => this.def(left, acc));
                    else
                        this.def(left, acc);
                    this.use(left, acc);
                }
                else if (left) {
                    this.walkValue(left, acc); // member/subscript target — uses only
                }
                // The RHS of a logical assignment is itself conditionally evaluated.
                if (right) {
                    if (logical)
                        this.conditional(() => this.walkValue(right, acc));
                    else
                        this.walkValue(right, acc);
                }
                return;
            }
            case 'update_expression': {
                const rawArg = node.childForFieldName('argument');
                const arg = rawArg ? this.unwrapLvalue(rawArg) : null;
                if (arg?.type === 'identifier') {
                    this.def(arg, acc);
                    this.use(arg, acc);
                }
                else if (arg) {
                    this.walkValue(arg, acc);
                }
                return;
            }
            case 'binary_expression': {
                // Short-circuit operators evaluate their RIGHT operand conditionally:
                // a def inside it (`a && (x = clean())`, `c ?? (c = load())`) must be
                // a may-def or the not-taken path's prior def is falsely killed
                // (tri-review P1). Other binary operators evaluate both sides.
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                const op = node.childForFieldName('operator')?.type ?? '';
                if (left)
                    this.walkValue(left, acc);
                if (right) {
                    if (op === '&&' || op === '||' || op === '??') {
                        this.conditional(() => this.walkValue(right, acc));
                    }
                    else {
                        this.walkValue(right, acc);
                    }
                }
                return;
            }
            case 'ternary_expression': {
                // Each arm is conditionally evaluated — defs inside are may-defs.
                const cond = node.childForFieldName('condition');
                const consequence = node.childForFieldName('consequence');
                const alternative = node.childForFieldName('alternative');
                if (cond)
                    this.walkValue(cond, acc);
                if (consequence)
                    this.conditional(() => this.walkValue(consequence, acc));
                if (alternative)
                    this.conditional(() => this.walkValue(alternative, acc));
                return;
            }
            case 'class_declaration': {
                // The class NAME is a def (prescan declared the binding) — without
                // this case the default walk would record it as a bogus USE in plain
                // JS (the name is an `identifier` there; in TS it's a type_identifier
                // and would be silently skipped, losing the def either way). The body
                // walk picks up field-initializer uses; methods are opaque nested fns.
                const name = node.childForFieldName('name');
                if (name)
                    this.def(name, acc);
                const body = node.childForFieldName('body');
                if (body)
                    this.walkValue(body, acc);
                return;
            }
            case 'class': {
                // Class EXPRESSION: its name (if any) binds only inside the class —
                // not a def in the enclosing function. Walk only the body.
                const body = node.childForFieldName('body');
                if (body)
                    this.walkValue(body, acc);
                return;
            }
            case 'call_expression':
                // #2083 M3 U1: explicit case (previously default-descended) — same
                // uses, plus a taint-site record. MUST keep defs/uses byte-identical.
                this.visitCall(node, acc, 'call');
                return;
            case 'new_expression':
                this.visitCall(node, acc, 'new');
                return;
            case 'member_expression':
            case 'subscript_expression':
                // #2083 M3 U1: value-position member chain — same uses as the old
                // default descent (root identifier + dynamic subscript indices), plus
                // a member-read site for the innermost identifier-rooted access.
                this.walkChain(node, acc, false);
                return;
            case 'sequence_expression': {
                // Comma operator: only the LAST operand's value flows. Earlier operands
                // are evaluated for side effects — record their uses but suppress
                // occurrence fan-out so `exec((log(x), 'safe'))` does not taint exec's
                // arg 0 with `x` (review fix). Defs/uses stay byte-identical to the old
                // default descent; only the sites layer narrows.
                const operands = [];
                for (let i = 0; i < node.namedChildCount; i++) {
                    const c = node.namedChild(i);
                    if (c)
                        operands.push(c);
                }
                const last = operands.length - 1;
                operands.forEach((op, i) => {
                    if (i === last)
                        this.walkValue(op, acc);
                    else
                        acc.suppressOccurrences(() => this.walkValue(op, acc));
                });
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
    /** Assignment-target walk: identifiers bind; member/subscript targets are uses. */
    walkDefPattern(node, acc) {
        switch (node.type) {
            case 'identifier':
            case 'shorthand_property_identifier_pattern':
                this.def(node, acc);
                return;
            case 'rest_pattern':
            case 'object_pattern':
            case 'array_pattern':
                for (let i = 0; i < node.namedChildCount; i++) {
                    const c = node.namedChild(i);
                    if (c)
                        this.walkDefPattern(c, acc);
                }
                return;
            case 'pair_pattern': {
                const key = node.childForFieldName('key');
                const value = node.childForFieldName('value');
                if (key?.type === 'computed_property_name')
                    this.walkValue(key, acc);
                if (value)
                    this.walkDefPattern(value, acc);
                return;
            }
            case 'assignment_pattern':
            case 'object_assignment_pattern': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                if (left)
                    this.walkDefPattern(left, acc);
                if (right)
                    this.walkValue(right, acc);
                return;
            }
            case 'member_expression':
            case 'subscript_expression':
                // Property/element write — NOT a scalar def (KTD4); its identifiers
                // (object, computed key) are uses. WRITE position (#2083 M3 U1): the
                // written access itself is not a value read — no member-read site for
                // it (`obj.p = q` records nothing; `req.body.x = v`'s mid-chain LOAD
                // of `req.body` still does).
                this.walkChain(node, acc, true);
                return;
            default:
                for (let i = 0; i < node.namedChildCount; i++) {
                    const c = node.namedChild(i);
                    if (c && !TYPE_CONTEXT_TYPES.has(c.type))
                        this.walkDefPattern(c, acc);
                }
        }
    }
    // ── taint-site harvest (#2083 M3 U1) ────────────────────────────────────
    /** Strip value-transparent wrappers (`(x)`, `x!`, `x as T`, `await x`). */
    unwrapValueWrappers(node) {
        let n = node;
        while (VALUE_WRAPPER_TYPES.has(n.type)) {
            const inner = n.namedChild(0);
            if (!inner)
                break;
            n = inner;
        }
        return n;
    }
    /**
     * When `value`'s root (after unwrapping) is a call/new node, remember that
     * its site should carry `resultDefs: defs` — consumed by {@link visitCall}
     * once the value walk reaches the node.
     */
    registerResultDefs(value, defs) {
        if (defs.length === 0)
            return;
        const root = this.unwrapValueWrappers(value);
        if (root.type === 'call_expression' || root.type === 'new_expression') {
            this.resultDefTargets.set(root.id, [...defs]);
        }
    }
    /**
     * Explicit call/new handler: records a call site (callee path, receiver,
     * per-arg occurrence entries, spread/template markers, require literal,
     * result defs) while reproducing EXACTLY the uses the old default descent
     * recorded — callee chain root + dynamic subscript indices + arguments.
     */
    visitCall(node, acc, kind) {
        const calleeNode = node.childForFieldName(kind === 'new' ? 'constructor' : 'function');
        const argsNode = node.childForFieldName('arguments');
        // `node` IS the call_expression/new_expression — the SAME node the
        // scope-extractor anchors `@reference.call.*` (its `atRange`) on (KTD7).
        const siteIdx = acc.openCallSite(kind, [node.startPosition.row + 1, node.startPosition.column]);
        acc.pushFrame(siteIdx);
        let calleePath;
        if (calleeNode) {
            const callee = this.unwrapValueWrappers(calleeNode);
            if (callee.type === 'identifier') {
                // The callee NAME is a statement-level use but NOT a value occurrence
                // flowing into any enclosing argument — `exec(escape(x))` must not
                // put the `escape` binding itself into exec's arg 0 (only x, tagged
                // via the escape site). Receiver-chain roots DO fan out (KTD5 TITO).
                acc.addUseWithoutOccurrence(this.resolve(callee));
                calleePath = callee.text;
            }
            else if (callee.type === 'member_expression' || callee.type === 'subscript_expression') {
                // skipFinalRead: the final access IS the callee, carried by the
                // dotted path — recording it as a member read would double-count.
                // Mid-chain reads (`req.body` inside `req.body.toString()`) ARE
                // recorded (plan KTD2).
                const chain = this.walkChain(callee, acc, true);
                calleePath = chain.path;
                if (chain.rootIdx !== undefined)
                    acc.setSiteReceiver(siteIdx, chain.rootIdx);
            }
            else {
                // Call-rooted chains, IIFEs, function expressions — no dotted path;
                // the walk still records uses and nested sites.
                this.walkValue(callee, acc);
            }
            if (calleePath !== undefined)
                acc.setSiteCallee(siteIdx, calleePath);
        }
        const resultDefs = this.resultDefTargets.get(node.id);
        if (resultDefs !== undefined)
            acc.setSiteResultDefs(siteIdx, resultDefs);
        if (argsNode?.type === 'template_string') {
            // Tagged template (`sql\`…${id}\``): the `arguments` field is a
            // template_string, not an arguments node — substitution occurrences
            // aggregate at position 0 and the site is marked non-positional.
            acc.setSiteTemplate(siteIdx);
            acc.setFrameArg(0);
            this.walkValue(argsNode, acc);
        }
        else if (argsNode) {
            let pos = 0;
            for (let i = 0; i < argsNode.namedChildCount; i++) {
                const arg = argsNode.namedChild(i);
                if (!arg || arg.type === 'comment')
                    continue;
                acc.setFrameArg(pos);
                if (arg.type === 'spread_element') {
                    acc.setSiteSpread(siteIdx, pos);
                    const inner = arg.namedChild(0);
                    if (inner)
                        this.walkValue(inner, acc);
                }
                else {
                    if (kind === 'call' && pos === 0 && calleePath === 'require' && arg.type === 'string') {
                        // CommonJS `require('lit')` — record the literal so the matcher
                        // resolves require'd aliases like ESM imports (plan KTD7).
                        acc.setSiteRequireArg(siteIdx, stringLiteralText(arg));
                    }
                    this.walkValue(arg, acc);
                }
                pos++;
            }
        }
        acc.popFrame();
    }
    /**
     * Member/subscript chain walk shared by value position, write position, and
     * callee position. Use-recording is identical to the old default descent
     * (chain-root identifier once, dynamic subscript index expressions, full
     * walk of non-identifier roots) — NO double-recording. Member-read sites:
     * at most ONE per chain — the INNERMOST access — and only when the chain
     * root is an identifier and the access's key is static (`.prop` or a
     * string-literal subscript); `skipFinalRead` suppresses it when that access
     * is the final one (callee / write target). Optional chaining (`?.`) never
     * appears in the output (field-based traversal normalizes it); dynamic
     * computed keys record nothing (documented KTD10 FN).
     */
    walkChain(node, acc, skipFinalRead) {
        // Collect accesses outer→inner (unshift), then resolve the root.
        const accesses = [];
        let cur = this.unwrapValueWrappers(node);
        for (;;) {
            if (cur.type === 'member_expression') {
                const prop = cur.childForFieldName('property');
                accesses.unshift({ prop: prop?.text });
                const obj = cur.childForFieldName('object');
                if (!obj)
                    break;
                cur = this.unwrapValueWrappers(obj);
            }
            else if (cur.type === 'subscript_expression') {
                const index = cur.childForFieldName('index');
                if (index?.type === 'string') {
                    accesses.unshift({ prop: stringLiteralText(index) });
                }
                else {
                    accesses.unshift({ dynamicIndex: index ?? undefined });
                }
                const obj = cur.childForFieldName('object');
                if (!obj)
                    break;
                cur = this.unwrapValueWrappers(obj);
            }
            else {
                break;
            }
        }
        let rootIdx;
        let rootSegment;
        if (cur.type === 'identifier') {
            rootIdx = this.resolve(cur);
            acc.addUse(rootIdx);
            rootSegment = cur.text;
        }
        else if (cur.type === 'this' || cur.type === 'super') {
            rootSegment = cur.text; // path segment only — `this`/`super` never bind
        }
        else {
            this.walkValue(cur, acc); // call-rooted etc. — uses + nested sites
        }
        // Dynamic subscript index expressions are real value reads (old default
        // descent walked them) — inner→outer matches the old recording order.
        for (const a of accesses) {
            if (a.dynamicIndex)
                this.walkValue(a.dynamicIndex, acc);
        }
        const innermost = accesses[0];
        if (rootIdx !== undefined &&
            innermost?.prop !== undefined &&
            !(skipFinalRead && accesses.length === 1)) {
            acc.addMemberRead(rootIdx, innermost.prop);
        }
        const path = rootSegment !== undefined && accesses.every((a) => a.prop !== undefined)
            ? [rootSegment, ...accesses.map((a) => a.prop)].join('.')
            : undefined;
        return { path, rootIdx };
    }
}
/** Ordered, deduplicating def/use collector for one statement record. */
class FactAccumulator {
    line;
    defs = [];
    uses = [];
    mayDefs = [];
    defSeen = new Set();
    useSeen = new Set();
    mayDefSeen = new Set();
    /** Taint sites recorded for this statement (#2083 M3 U1). */
    sites = [];
    /** Composite (object|property|parent) keys of recorded member-read sites, so
     *  dedup is O(1) instead of a rescan of `sites` per read. */
    memberReadKeys = new Set();
    /** Stack of open call/new sites — the occurrence fan-out targets. */
    frames = [];
    constructor(line) {
        this.line = line;
    }
    addDef(idx) {
        if (this.defSeen.has(idx))
            return;
        this.defSeen.add(idx);
        this.defs.push(idx);
    }
    /** A def that may not execute (conditional context) — gen without kill. */
    addMayDef(idx) {
        if (this.mayDefSeen.has(idx))
            return;
        this.mayDefSeen.add(idx);
        this.mayDefs.push(idx);
    }
    addUse(idx) {
        // Occurrence fan-out happens BEFORE the statement-level dedup: `exec(x, x)`
        // records x at BOTH arg positions even though `uses` lists it once.
        this.recordOccurrence(idx);
        this.addUseWithoutOccurrence(idx);
    }
    /**
     * Statement-level use that is NOT a value occurrence in any open site
     * argument — bare callee names only (#2083 M3 U1, see visitCall).
     */
    addUseWithoutOccurrence(idx) {
        if (this.useSeen.has(idx))
            return;
        this.useSeen.add(idx);
        this.uses.push(idx);
    }
    defCount() {
        return this.defs.length + this.mayDefs.length;
    }
    useCount() {
        return this.uses.length;
    }
    // ── site machinery (#2083 M3 U1) ─────────────────────────────────────────
    /** `[defs.length, mayDefs.length]` marker for {@link defsSince}. */
    defSnapshot() {
        return [this.defs.length, this.mayDefs.length];
    }
    /** Binding indices def'd (must- OR may-) since the snapshot was taken. */
    defsSince(snap) {
        return [...this.defs.slice(snap[0]), ...this.mayDefs.slice(snap[1])];
    }
    /**
     * Open a call/new site; parent = innermost enclosing argument position. `at`
     * is the call/new node's anchor position `[line (1-based), col (0-based)]` —
     * the SAME position the CALLS-edge resolution keys on (KTD7; see
     * {@link SiteRecord.at}).
     */
    openCallSite(kind, at) {
        const site = { kind };
        const parent = this.innermostArgPosition();
        if (parent)
            site.parent = parent;
        if (at)
            site.at = [at[0], at[1]];
        this.sites.push(site);
        return this.sites.length - 1;
    }
    pushFrame(siteIdx) {
        this.frames.push({ siteIdx, argIdx: -1 });
    }
    popFrame() {
        this.frames.pop();
    }
    /** Set the argument position the top frame is currently walking. */
    setFrameArg(argIdx) {
        const top = this.frames[this.frames.length - 1];
        if (top)
            top.argIdx = argIdx;
    }
    /**
     * Run `fn` with all open arg frames temporarily detached (argIdx = -1), so
     * identifier reads inside still record USES but do NOT fan occurrences into
     * the enclosing sink-argument position. Used for the non-value operands of a
     * sequence (comma) expression — only the final operand's value flows.
     */
    suppressOccurrences(fn) {
        const saved = this.frames.map((f) => f.argIdx);
        for (const f of this.frames)
            f.argIdx = -1;
        try {
            fn();
        }
        finally {
            this.frames.forEach((f, i) => {
                f.argIdx = saved[i];
            });
        }
    }
    setSiteCallee(siteIdx, callee) {
        this.sites[siteIdx].callee = callee;
    }
    setSiteReceiver(siteIdx, receiver) {
        this.sites[siteIdx].receiver = receiver;
    }
    setSiteResultDefs(siteIdx, resultDefs) {
        this.sites[siteIdx].resultDefs = [...resultDefs];
    }
    setSiteSpread(siteIdx, firstSpreadArg) {
        const site = this.sites[siteIdx];
        if (site.spread === undefined)
            site.spread = firstSpreadArg;
    }
    setSiteTemplate(siteIdx) {
        this.sites[siteIdx].template = true;
    }
    setSiteRequireArg(siteIdx, literal) {
        this.sites[siteIdx].requireArg = literal;
    }
    /**
     * Record a value-position member read. Exact duplicates within the
     * statement (same object/property/parent position) dedup; reads at
     * DIFFERENT argument positions stay distinct (`exec(req.body, req.body)`
     * is two occurrences — KTD6 finding identity needs both).
     */
    addMemberRead(object, property) {
        const parent = this.innermostArgPosition();
        const dedupKey = `${object}|${property}|${parent ? `${parent[0]}:${parent[1]}` : 'top'}`;
        if (this.memberReadKeys.has(dedupKey))
            return;
        this.memberReadKeys.add(dedupKey);
        const site = { kind: 'member-read' };
        if (parent)
            site.parent = parent;
        site.object = object;
        site.property = property;
        this.sites.push(site);
    }
    innermostArgPosition() {
        for (let i = this.frames.length - 1; i >= 0; i--) {
            const f = this.frames[i];
            if (f.argIdx >= 0)
                return [f.siteIdx, f.argIdx];
        }
        return undefined;
    }
    /**
     * Fan a binding occurrence out to every arg-active open frame. The entry is
     * via-tagged with the site of the IMMEDIATELY nested frame when one exists:
     * `exec(escape(x))` puts a plain `x` in escape's arg 0 and `[x, escapeIdx]`
     * in exec's arg 0 — the KTD4a interposition substrate.
     */
    recordOccurrence(idx) {
        for (let i = this.frames.length - 1; i >= 0; i--) {
            const f = this.frames[i];
            if (f.argIdx < 0)
                continue;
            const via = i + 1 < this.frames.length ? this.frames[i + 1].siteIdx : undefined;
            this.pushArgEntry(f.siteIdx, f.argIdx, idx, via);
        }
    }
    pushArgEntry(siteIdx, argIdx, bindingIdx, via) {
        const site = this.sites[siteIdx];
        const args = (site.args ??= []);
        while (args.length <= argIdx)
            args.push([]);
        const list = args[argIdx];
        // Dedup exact (binding, via) pairs per position — `f(x + x)` is one entry;
        // `f(x + g(x))` keeps the plain AND the via-tagged entry (distinct paths).
        for (const e of list) {
            const match = typeof e === 'number'
                ? via === undefined && e === bindingIdx
                : via !== undefined && e[0] === bindingIdx && e[1] === via;
            if (match)
                return;
        }
        list.push(via === undefined ? bindingIdx : [bindingIdx, via]);
    }
    finish() {
        return {
            line: this.line,
            defs: this.defs,
            uses: this.uses,
            // Optional field stays absent when empty — keeps the serialized
            // side-channel payload lean (most statements have no may-defs).
            ...(this.mayDefs.length > 0 ? { mayDefs: this.mayDefs } : {}),
            // Sites likewise omit-when-empty (#2083 M3 U1): flag-off runs never
            // harvest, and most fact-bearing statements carry no calls.
            ...(this.sites.length > 0 ? { sites: this.sites.map(finalizeSite) } : {}),
        };
    }
}
/** Trim trailing empty arg positions; drop `args` entirely when all-empty. */
const finalizeSite = (site) => {
    const args = site.args;
    if (args !== undefined) {
        let end = args.length;
        while (end > 0 && args[end - 1].length === 0)
            end--;
        if (end === 0)
            delete site.args;
        else if (end < args.length)
            site.args = args.slice(0, end);
    }
    return site;
};
