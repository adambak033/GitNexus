import { CallSiteFactAccumulator as FactAccumulator, finalizeChain } from './call-site-harvest.js';
/** Node types that own a nested CFG — their subtrees are opaque to harvesting. */
const NESTED_FUNCTION_TYPES = new Set(['function_definition', 'lambda']);
/** LHS pattern containers whose identifier/splat leaves are assignment targets. */
const PATTERN_LIST_TYPES = new Set(['pattern_list', 'tuple_pattern', 'list_pattern']);
export class PythonHarvester {
    fnNode;
    bindings = [];
    /** Single function-scope name → binding index (Python has no block scope). */
    table = new Map();
    synthetic = new Map();
    /** Names declared `global`/`nonlocal` — resolve to the synthetic module binding. */
    globalNames = new Set();
    fnId;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    conditionalDepth = 0;
    /**
     * `call` node id → binding indices its result is assigned to (`x = f()` ⇒
     * `[x]`, `a, b = f()` ⇒ `[a, b]`). Populated just before the value walk reaches
     * the call (see {@link registerResultDefs}) and consumed by {@link visitCall}.
     * Mirrors the Go harvester's `resultDefTargets`.
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
    /** The function/lambda body node (a `block` for `def`, an expression for `lambda`). */
    bodyOf(fnNode) {
        return fnNode.childForFieldName('body') ?? undefined;
    }
    // ── phase 1: declaration pre-scan ────────────────────────────────────────
    declare(nameNode, kind) {
        const name = nameNode.text;
        if (!name || name === '_' || this.table.has(name) || this.globalNames.has(name))
            return;
        this.table.set(name, this.bindings.length);
        this.bindings.push({
            name,
            declLine: nameNode.startPosition.row + 1,
            declColumn: nameNode.startPosition.column,
            kind,
        });
    }
    /** Declare every parameter binder (incl. defaults, typed, `*args`, `**kwargs`). */
    declareParams(fnNode) {
        const params = fnNode.childForFieldName('parameters') ??
            fnNode.namedChildren.find((c) => c.type === 'parameters' || c.type === 'lambda_parameters');
        if (!params)
            return;
        for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i);
            if (p)
                this.declareParam(p);
        }
    }
    /** Declare the binder identifier(s) of one parameter node. */
    declareParam(p) {
        switch (p.type) {
            case 'identifier':
                this.declare(p, 'param');
                return;
            case 'default_parameter':
            case 'typed_default_parameter': {
                const name = p.childForFieldName('name');
                if (name)
                    this.declareParamBinder(name);
                return;
            }
            case 'typed_parameter': {
                // No `name` field — the binder is the first non-`type` named child
                // (an identifier or a splat pattern).
                const typeNode = p.childForFieldName('type');
                for (let i = 0; i < p.namedChildCount; i++) {
                    const c = p.namedChild(i);
                    if (c && c.id !== typeNode?.id) {
                        this.declareParamBinder(c);
                        break;
                    }
                }
                return;
            }
            case 'list_splat_pattern':
            case 'dictionary_splat_pattern':
                this.declareParamBinder(p);
                return;
            default:
                // tuple-grouped params and the like — declare any identifier leaves.
                this.declareParamBinder(p);
        }
    }
    /** Declare a binder that may be an identifier or a `*`/`**` splat pattern. */
    declareParamBinder(node) {
        if (node.type === 'identifier') {
            this.declare(node, 'param');
            return;
        }
        if (node.type === 'list_splat_pattern' || node.type === 'dictionary_splat_pattern') {
            const id = node.namedChild(0);
            if (id?.type === 'identifier')
                this.declare(id, 'param');
            return;
        }
        // Nested grouping — declare identifier descendants up to the next binder.
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (c?.type === 'identifier')
                this.declare(c, 'param');
        }
    }
    /**
     * Pre-scan the function body once, declaring every in-function name. Recurses
     * into compound statements but NOT into nested `function_definition` / `lambda`
     * bodies (opaque). `global`/`nonlocal` are processed FIRST in a sibling sweep
     * so a later assignment to a global name does not mint a function-local.
     */
    prescan(node) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId) {
            if (t === 'function_definition') {
                const name = node.childForFieldName('name');
                if (name?.type === 'identifier')
                    this.declare(name, 'function');
            }
            return;
        }
        if (t === 'class_definition') {
            const name = node.childForFieldName('name');
            if (name?.type === 'identifier')
                this.declare(name, 'class');
            return;
        }
        switch (t) {
            case 'global_statement':
            case 'nonlocal_statement': {
                for (let i = 0; i < node.namedChildCount; i++) {
                    const c = node.namedChild(i);
                    if (c?.type === 'identifier')
                        this.globalNames.add(c.text);
                }
                return;
            }
            case 'assignment': {
                const left = node.childForFieldName('left');
                if (left)
                    this.declareTargets(left);
                break;
            }
            case 'augmented_assignment': {
                const left = node.childForFieldName('left');
                if (left)
                    this.declareTargets(left);
                break;
            }
            case 'named_expression': {
                const name = node.childForFieldName('name');
                if (name?.type === 'identifier')
                    this.declare(name, 'let');
                break;
            }
            case 'for_statement':
            case 'for_in_clause': {
                const left = node.childForFieldName('left');
                if (left)
                    this.declareTargets(left);
                break;
            }
            case 'with_item': {
                this.declareWithItem(node);
                break;
            }
            case 'except_clause':
            case 'except_group_clause': {
                this.declareExceptAlias(node);
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
    /** Declare identifier/splat leaves of an assignment / loop target pattern. */
    declareTargets(target) {
        const t = target.type;
        if (t === 'identifier') {
            this.declare(target, 'let');
            return;
        }
        if (PATTERN_LIST_TYPES.has(t)) {
            for (let i = 0; i < target.namedChildCount; i++) {
                const c = target.namedChild(i);
                if (c)
                    this.declareTargets(c);
            }
            return;
        }
        if (t === 'list_splat_pattern') {
            const id = target.namedChild(0);
            if (id?.type === 'identifier')
                this.declare(id, 'let');
            return;
        }
        // attribute / subscript target — not a scalar def (root is a use only).
    }
    /** `with EXPR as TARGET` — declare the alias target(s). */
    declareWithItem(item) {
        const value = item.childForFieldName('value') ?? item.namedChild(0);
        if (value?.type !== 'as_pattern')
            return;
        const alias = value.childForFieldName('alias') ?? this.asPatternTarget(value);
        if (alias)
            this.declareAsTarget(alias);
    }
    /** `except E as e` — declare `e`. */
    declareExceptAlias(clause) {
        for (let i = 0; i < clause.namedChildCount; i++) {
            const c = clause.namedChild(i);
            if (c?.type === 'as_pattern') {
                const alias = c.childForFieldName('alias') ?? this.asPatternTarget(c);
                if (alias)
                    this.declareAsTarget(alias, 'catch');
            }
        }
    }
    /** The `as_pattern_target` child of an `as_pattern` (when no `alias` field). */
    asPatternTarget(asPattern) {
        return asPattern.namedChildren.find((c) => c.type === 'as_pattern_target');
    }
    /** Declare an `as_pattern_target` (or its identifier child) as a binding. */
    declareAsTarget(target, kind = 'let') {
        if (target.type === 'identifier') {
            this.declare(target, kind);
            return;
        }
        // `as_pattern_target` wraps an identifier (or a tuple pattern).
        const inner = target.namedChild(0);
        if (inner?.type === 'identifier')
            this.declare(inner, kind);
        else if (inner)
            this.declareTargets(inner);
        else
            this.declare(target, kind); // a bare `as_pattern_target` text IS the name
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
     * Facts for a `for TARGET in ITER` / `for_in_clause` head: the loop target(s)
     * are defs, the iterated expression is a use.
     */
    loopHeadFacts(headNode) {
        const acc = new FactAccumulator(headNode.startPosition.row + 1);
        const left = headNode.childForFieldName('left');
        const right = headNode.childForFieldName('right');
        if (right)
            this.walkValue(right, acc);
        if (left)
            this.defTargets(left, acc);
        return acc.finish();
    }
    /** Facts for a `with_item`: the `as` alias is a def, the value an use. */
    withItemFacts(item) {
        const acc = new FactAccumulator(item.startPosition.row + 1);
        const value = item.childForFieldName('value') ?? item.namedChild(0);
        if (!value)
            return acc.finish();
        if (value.type === 'as_pattern') {
            const inner = value.namedChild(0);
            if (inner)
                this.walkValue(inner, acc);
            const alias = value.childForFieldName('alias') ?? this.asPatternTarget(value);
            if (alias)
                this.defAsTarget(alias, acc);
        }
        else {
            this.walkValue(value, acc);
        }
        return acc.finish();
    }
    /** Facts for an `except E as e:` header: `e` is a def, `E` a use. */
    exceptHeadFacts(clause) {
        const acc = new FactAccumulator(clause.startPosition.row + 1);
        const block = clause.namedChildren.find((c) => c.type === 'block');
        for (let i = 0; i < clause.namedChildCount; i++) {
            const c = clause.namedChild(i);
            if (!c || c.id === block?.id)
                continue;
            if (c.type === 'as_pattern') {
                const exc = c.namedChild(0);
                if (exc)
                    this.walkValue(exc, acc);
                const alias = c.childForFieldName('alias') ?? this.asPatternTarget(c);
                if (alias)
                    this.defAsTarget(alias, acc);
            }
            else {
                this.walkValue(c, acc);
            }
        }
        return acc.finish();
    }
    /** ENTRY-block facts for the parameters (defs only — incl. default-value uses). */
    paramFacts() {
        const params = this.fnNode.childForFieldName('parameters') ??
            this.fnNode.namedChildren.find((c) => c.type === 'parameters' || c.type === 'lambda_parameters');
        if (!params)
            return undefined;
        const acc = new FactAccumulator(this.fnNode.startPosition.row + 1);
        for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i);
            if (p)
                this.defParam(p, acc);
        }
        return acc.defCount() || acc.finish().uses.length ? acc.finish() : undefined;
    }
    /** Def the binder(s) of one parameter node and use any default-value expr. */
    defParam(p, acc) {
        switch (p.type) {
            case 'identifier':
                this.def(p, acc);
                return;
            case 'default_parameter':
            case 'typed_default_parameter': {
                const value = p.childForFieldName('value');
                if (value)
                    this.walkValue(value, acc);
                const name = p.childForFieldName('name');
                if (name)
                    this.defParamBinder(name, acc);
                return;
            }
            case 'typed_parameter': {
                const typeNode = p.childForFieldName('type');
                for (let i = 0; i < p.namedChildCount; i++) {
                    const c = p.namedChild(i);
                    if (c && c.id !== typeNode?.id) {
                        this.defParamBinder(c, acc);
                        break;
                    }
                }
                return;
            }
            case 'list_splat_pattern':
            case 'dictionary_splat_pattern':
                this.defParamBinder(p, acc);
                return;
            default:
                this.defParamBinder(p, acc);
        }
    }
    defParamBinder(node, acc) {
        if (node.type === 'identifier') {
            this.def(node, acc);
            return;
        }
        if (node.type === 'list_splat_pattern' || node.type === 'dictionary_splat_pattern') {
            const id = node.namedChild(0);
            if (id?.type === 'identifier')
                this.def(id, acc);
            return;
        }
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (c?.type === 'identifier')
                this.def(c, acc);
        }
    }
    resolve(nameNode) {
        const name = nameNode.text;
        if (!this.globalNames.has(name)) {
            const idx = this.table.get(name);
            if (idx !== undefined)
                return idx;
        }
        let idx = this.synthetic.get(name);
        if (idx === undefined) {
            idx = this.bindings.length;
            this.synthetic.set(name, idx);
            this.bindings.push({ name, declLine: 0, declColumn: 0, kind: 'module', synthetic: true });
        }
        return idx;
    }
    def(nameNode, acc) {
        if (nameNode.text === '_')
            return; // blank target defines nothing of interest
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
    /**
     * Def each identifier/splat leaf of an assignment / loop target pattern; route
     * attribute / subscript targets to the value walk (root identifier is a use).
     */
    defTargets(target, acc) {
        const t = target.type;
        if (t === 'identifier') {
            this.def(target, acc);
            return;
        }
        if (PATTERN_LIST_TYPES.has(t)) {
            for (let i = 0; i < target.namedChildCount; i++) {
                const c = target.namedChild(i);
                if (c)
                    this.defTargets(c, acc);
            }
            return;
        }
        if (t === 'list_splat_pattern') {
            const id = target.namedChild(0);
            if (id?.type === 'identifier')
                this.def(id, acc);
            else if (id)
                this.defTargets(id, acc);
            return;
        }
        // attribute / subscript / call target — uses only (the root identifier).
        this.walkValue(target, acc);
    }
    /** Def an `as_pattern_target` (or its identifier child). */
    defAsTarget(target, acc) {
        if (target.type === 'identifier') {
            this.def(target, acc);
            return;
        }
        const inner = target.namedChild(0);
        if (inner?.type === 'identifier')
            this.def(inner, acc);
        else if (inner)
            this.defTargets(inner, acc);
        else
            this.def(target, acc);
    }
    /** Value-position walk: collect uses; route def positions to the target handler. */
    walkValue(node, acc) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId)
            return; // opaque
        switch (t) {
            case 'identifier':
                this.use(node, acc);
                return;
            case 'assignment': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                // Register result-defs BEFORE walking the value so the nested call site
                // (reached during the value walk) carries them. Plain and unpack targets
                // are preserved; attribute/subscript LHS attaches nothing.
                if (left && right)
                    this.registerResultDefs(right, this.targetDefIndices(left));
                if (right)
                    this.walkValue(right, acc);
                if (left)
                    this.defTargets(left, acc);
                return;
            }
            case 'augmented_assignment': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                if (right)
                    this.walkValue(right, acc);
                if (left) {
                    // `x += v` reads AND writes a plain-identifier lvalue.
                    if (left.type === 'identifier') {
                        this.use(left, acc);
                        this.def(left, acc);
                    }
                    else {
                        this.walkValue(left, acc); // attribute/subscript lvalue — use only
                    }
                }
                return;
            }
            case 'named_expression': {
                // walrus `(n := v)` — `n` is a def, `v` a use.
                const name = node.childForFieldName('name');
                const value = node.childForFieldName('value');
                if (name?.type === 'identifier' && value) {
                    this.registerResultDefs(value, this.targetDefIndices(name));
                }
                if (value)
                    this.walkValue(value, acc);
                if (name?.type === 'identifier')
                    this.def(name, acc);
                return;
            }
            case 'boolean_operator': {
                // `a or b` / `a and b` — the right operand is conditionally evaluated, so
                // any def inside it (a walrus) is a may-def; uses are still recorded.
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                if (left)
                    this.walkValue(left, acc);
                if (right)
                    this.conditional(() => this.walkValue(right, acc));
                return;
            }
            case 'conditional_expression': {
                // `consequent if condition else alternative`. The condition always
                // evaluates; each arm is conditional (its walrus defs are may-defs).
                const children = node.namedChildren;
                const [consequent, condition, alternative] = children;
                if (condition)
                    this.walkValue(condition, acc);
                if (consequent)
                    this.conditional(() => this.walkValue(consequent, acc));
                if (alternative)
                    this.conditional(() => this.walkValue(alternative, acc));
                return;
            }
            case 'attribute': {
                // `a.b` — value read of the operand root only; the attribute name is not
                // a scalar binding. Records the chain-root use plus at most ONE
                // member-read site (the innermost identifier-rooted access), mirroring
                // the Go harvester's value-position `walkChain`.
                this.walkChain(node, acc, false);
                return;
            }
            case 'subscript': {
                // `a[i]` — both the container root and the index are uses.
                const value = node.childForFieldName('value');
                const sub = node.childForFieldName('subscript');
                if (value)
                    this.walkValue(value, acc);
                if (sub)
                    this.walkValue(sub, acc);
                return;
            }
            case 'call':
                // #2227 follow-up: explicit case (previously default-descended) — same
                // uses, plus a taint-site record. Python has no `new` (constructor calls
                // are plain `call`s). Defs/uses stay byte-identical.
                this.visitCall(node, acc);
                return;
            case 'list_comprehension':
            case 'set_comprehension':
            case 'dictionary_comprehension':
            case 'generator_expression': {
                this.walkComprehension(node, acc);
                return;
            }
            case 'keyword_argument': {
                // `f(k=v)` — `k` is a parameter name, not a use; only `v` is a use.
                const value = node.childForFieldName('value');
                if (value)
                    this.walkValue(value, acc);
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
    /**
     * A comprehension (`[body for t in src if g]`): each `for_in_clause` target is
     * a def, its source a use; the `body` and any `if_clause` are uses. Kept INLINE
     * (no separate CFG blocks) per the plan — the target binding is harvested so it
     * is a real def. The `for_in_clause` source is walked in the ENCLOSING context
     * (it reads outer names), the body/filter after the targets are bound.
     */
    walkComprehension(node, acc) {
        const body = node.childForFieldName('body');
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (!c)
                continue;
            if (c.type === 'for_in_clause') {
                const left = c.childForFieldName('left');
                const right = c.childForFieldName('right');
                if (right)
                    this.walkValue(right, acc);
                if (left)
                    this.defTargets(left, acc);
            }
            else if (c.id !== body?.id) {
                // `if_clause` filter (and any other auxiliary clause) — uses only.
                this.walkValue(c, acc);
            }
        }
        if (body)
            this.walkValue(body, acc);
    }
    /** Binding indices assigned by a target pattern, without mutating statement facts. */
    targetDefIndices(target) {
        if (target.type === 'identifier')
            return target.text === '_' ? [] : [this.resolve(target)];
        if (PATTERN_LIST_TYPES.has(target.type)) {
            const out = [];
            for (let i = 0; i < target.namedChildCount; i++) {
                const c = target.namedChild(i);
                if (c)
                    out.push(...this.targetDefIndices(c));
            }
            return out;
        }
        if (target.type === 'list_splat_pattern') {
            const id = target.namedChild(0);
            return id ? this.targetDefIndices(id) : [];
        }
        return [];
    }
    /** Record result defs for a call-valued assignment. */
    registerResultDefs(value, defs) {
        if (defs.length === 0)
            return;
        const root = this.unwrapValue(value);
        if (root.type === 'call')
            this.resultDefTargets.set(root.id, [...defs]);
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
     * Explicit `call` handler. Records a call site (callee path, receiver, per-arg
     * occurrence entries, result defs, spread marker) while reproducing EXACTLY
     * the uses the old default descent recorded (callee chain root + arguments).
     * Python has no `new` — every site is `kind: 'call'`.
     */
    visitCall(node, acc) {
        const calleeNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');
        // `node` IS the `call` — the SAME node the scope-extractor anchors
        // `@reference.call.free/.member` on (its `atRange`), so the resolved-id join
        // lands by exact position.
        const siteIdx = acc.openCallSite('call', [
            node.startPosition.row + 1,
            node.startPosition.column,
        ]);
        acc.pushFrame(siteIdx);
        if (calleeNode) {
            const callee = this.unwrapValue(calleeNode);
            if (callee.type === 'identifier') {
                if (callee.text !== '_')
                    acc.addUseWithoutOccurrence(this.resolve(callee));
                acc.setSiteCallee(siteIdx, callee.text);
            }
            else if (callee.type === 'attribute') {
                // skipFinalRead: the final `.attr` IS the callee, carried by the path.
                const chain = this.walkChain(callee, acc, true);
                if (chain.path !== undefined)
                    acc.setSiteCallee(siteIdx, chain.path);
                if (chain.rootIdx !== undefined)
                    acc.setSiteReceiver(siteIdx, chain.rootIdx);
            }
            else {
                // Call-rooted chains (`a().b()`), subscripts (`d[k]()`) — the walk still
                // records uses and nested sites; the callee path is not statically known.
                this.walkValue(callee, acc);
            }
        }
        const resultDefs = this.resultDefTargets.get(node.id);
        if (resultDefs !== undefined)
            acc.setSiteResultDefs(siteIdx, resultDefs);
        this.walkArgs(argsNode, acc, siteIdx);
        acc.popFrame();
    }
    /** Walk arguments, assigning only positional values to positional sink slots. */
    walkArgs(args, acc, siteIdx) {
        if (!args)
            return;
        let pos = 0;
        for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i);
            if (!arg || arg.type === 'comment')
                continue;
            if (arg.type === 'keyword_argument') {
                const value = arg.childForFieldName('value');
                // SiteRecord has no keyword-name metadata. Keep the value's ordinary
                // uses/sources, but do not guess a positional sink slot from source order.
                if (value)
                    acc.suppressOccurrences(() => this.walkValue(value, acc));
            }
            else if (arg.type === 'list_splat') {
                acc.setFrameArg(pos);
                acc.setSiteSpread(siteIdx, pos);
                const inner = arg.namedChild(0);
                if (inner)
                    this.walkValue(inner, acc);
                pos++;
            }
            else if (arg.type === 'dictionary_splat') {
                const inner = arg.namedChild(0);
                if (inner)
                    acc.suppressOccurrences(() => this.walkValue(inner, acc));
            }
            else {
                acc.setFrameArg(pos);
                this.walkValue(arg, acc);
                pos++;
            }
        }
    }
    /**
     * `attribute` chain walk shared by value position and callee position. Records
     * the chain-root identifier as a use (identical to the old default descent)
     * plus at most ONE member-read site — the INNERMOST access — when the root is
     * an identifier; `skipFinalRead` suppresses it when that access is the callee
     * (carried by the dotted path instead). Mirrors the Go harvester's `walkChain`.
     */
    walkChain(node, acc, skipFinalRead) {
        const accesses = [];
        let cur = this.unwrapValue(node);
        for (;;) {
            if (cur.type === 'attribute') {
                const field = cur.childForFieldName('attribute');
                accesses.unshift(field?.text ?? '');
                const operand = cur.childForFieldName('object');
                if (!operand)
                    break;
                cur = this.unwrapValue(operand);
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
