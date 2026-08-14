import { CallSiteFactAccumulator as FactAccumulator } from './call-site-harvest.js';
/** Node types that own a nested CFG — their subtrees are opaque to harvesting. */
const NESTED_FUNCTION_TYPES = new Set([
    'method',
    'singleton_method',
    'do_block',
    'block',
    'lambda',
]);
/** Parameter container node types (method + block + lambda). */
const PARAM_CONTAINER_TYPES = new Set([
    'method_parameters',
    'block_parameters',
    'lambda_parameters',
]);
/** Parameter leaf node types whose `name` field (or bare identifier) is the binder. */
const NAMED_PARAM_TYPES = new Set([
    'optional_parameter',
    'splat_parameter',
    'hash_splat_parameter',
    'block_parameter',
    'keyword_parameter',
]);
export class RubyHarvester {
    fnNode;
    bindings = [];
    /** Single function-scope name → binding index (documented over-approximation). */
    table = new Map();
    synthetic = new Map();
    fnId;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    conditionalDepth = 0;
    /**
     * `call` node id → binding indices its single-target result is assigned to
     * (`x = f()` ⇒ `[x]`). Populated just before the value walk reaches the call
     * (see {@link registerResultDefs}) and consumed by {@link visitCall}. Mirrors
     * the Python / Kotlin / Go harvesters' `resultDefTargets`.
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
    /** The function/block/lambda body node. */
    bodyOf(fnNode) {
        return fnNode.childForFieldName('body') ?? undefined;
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
    /** Declare every parameter binder (method / block / lambda). */
    declareParams(fnNode) {
        const params = this.paramsOf(fnNode);
        if (!params)
            return;
        for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i);
            if (p)
                this.declareParam(p);
        }
    }
    /** The `parameters` field (or first parameter-container child) of a function node. */
    paramsOf(fnNode) {
        const field = fnNode.childForFieldName('parameters');
        if (field)
            return field;
        return fnNode.namedChildren.find((c) => PARAM_CONTAINER_TYPES.has(c.type));
    }
    /** Declare the binder identifier of one parameter node. */
    declareParam(p) {
        if (p.type === 'identifier') {
            this.declare(p, 'param');
            return;
        }
        if (NAMED_PARAM_TYPES.has(p.type)) {
            const name = p.childForFieldName('name') ?? p.namedChildren.find((c) => c.type === 'identifier');
            if (name)
                this.declare(name, 'param');
            return;
        }
        // Destructured / grouped block param — declare any identifier leaves.
        for (let i = 0; i < p.namedChildCount; i++) {
            const c = p.namedChild(i);
            if (c?.type === 'identifier')
                this.declare(c, 'param');
            else if (c)
                this.declareParam(c);
        }
    }
    /**
     * Pre-scan the function body once, declaring every in-function local name.
     * Recurses into compound statements but NOT into nested function/block/lambda
     * bodies (opaque).
     */
    prescan(node) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId)
            return;
        switch (t) {
            case 'assignment': {
                const left = node.childForFieldName('left');
                if (left)
                    this.declareTargets(left);
                break;
            }
            case 'operator_assignment': {
                const left = node.childForFieldName('left');
                if (left)
                    this.declareTargets(left);
                break;
            }
            case 'for': {
                const pattern = node.childForFieldName('pattern');
                if (pattern)
                    this.declareTargets(pattern);
                break;
            }
            case 'rescue': {
                this.declareRescueVar(node);
                break;
            }
            default:
                break;
        }
        // A nested `do_block`/`block`/`lambda` body is opaque, but its OWN block
        // parameters are declared (they are not local to THIS function, yet the
        // single-table model harvests them where used) — handled by declareParam in
        // the visitor's per-block harvester instance, not here. We only recurse to
        // collect assignment/for/rescue local targets in THIS function body.
        for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i);
            if (c)
                this.prescan(c);
        }
    }
    /** `rescue [Exc] => e` — declare `e` (a `catch`-kind def). */
    declareRescueVar(clause) {
        const variable = clause.childForFieldName('variable');
        const id = variable?.namedChildren.find((c) => c.type === 'identifier') ?? variable;
        if (id?.type === 'identifier')
            this.declare(id, 'catch');
    }
    /** Declare identifier leaves of an assignment / loop target (skip non-local LHS). */
    declareTargets(target) {
        const t = target.type;
        if (t === 'identifier') {
            this.declare(target, 'let');
            return;
        }
        if (t === 'left_assignment_list') {
            for (let i = 0; i < target.namedChildCount; i++) {
                const c = target.namedChild(i);
                if (c)
                    this.declareTargets(c);
            }
            return;
        }
        if (t === 'splat_parameter' || t === 'rest_assignment') {
            const id = target.namedChildren.find((c) => c.type === 'identifier');
            if (id)
                this.declare(id, 'let');
            return;
        }
        // instance/class/global var, constant, element/attribute target — not a
        // function-scoped scalar def (the root identifier is a use only).
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
     * Facts for a `for PATTERN in VALUE` head: the loop target(s) are defs, the
     * iterated expression is a use.
     */
    loopHeadFacts(forNode) {
        const acc = new FactAccumulator(forNode.startPosition.row + 1);
        const pattern = forNode.childForFieldName('pattern');
        const value = forNode.childForFieldName('value');
        if (value)
            this.walkValue(value, acc);
        if (pattern)
            this.defTargets(pattern, acc);
        return acc.finish();
    }
    /**
     * Def-ONLY facts for a value-position assignment (`x = if … / case …`, #2205):
     * just the LHS target(s), attached to the continuation block the branch arms
     * rejoin. The branch condition + arm-value USES are harvested onto the branch's
     * own blocks (visitIf / visitCase), so this must not re-walk the RHS.
     */
    assignmentDefFacts(stmt) {
        const acc = new FactAccumulator(stmt.startPosition.row + 1);
        const left = stmt.childForFieldName('left');
        if (left)
            this.defTargets(left, acc);
        return acc.defCount() ? acc.finish() : undefined;
    }
    /** Facts for a `rescue [Exc] => e` header: `e` is a def, the exception list a use. */
    rescueHeadFacts(clause) {
        const acc = new FactAccumulator(clause.startPosition.row + 1);
        const exceptions = clause.childForFieldName('exceptions');
        if (exceptions)
            this.walkValue(exceptions, acc);
        const variable = clause.childForFieldName('variable');
        const id = variable?.namedChildren.find((c) => c.type === 'identifier');
        if (id)
            this.def(id, acc);
        return acc.finish();
    }
    /** ENTRY-block facts for the parameters (defs only — incl. default-value uses). */
    paramFacts() {
        const params = this.paramsOf(this.fnNode);
        if (!params)
            return undefined;
        const acc = new FactAccumulator(this.fnNode.startPosition.row + 1);
        for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i);
            if (p)
                this.defParam(p, acc);
        }
        return acc.defCount() || acc.useCount() ? acc.finish() : undefined;
    }
    /** Def the binder of one parameter node and use any default-value expr. */
    defParam(p, acc) {
        if (p.type === 'identifier') {
            this.def(p, acc);
            return;
        }
        if (p.type === 'optional_parameter' || p.type === 'keyword_parameter') {
            const value = p.childForFieldName('value');
            if (value)
                this.walkValue(value, acc);
            const name = p.childForFieldName('name');
            if (name)
                this.def(name, acc);
            return;
        }
        if (NAMED_PARAM_TYPES.has(p.type)) {
            const name = p.childForFieldName('name') ?? p.namedChildren.find((c) => c.type === 'identifier');
            if (name)
                this.def(name, acc);
            return;
        }
        for (let i = 0; i < p.namedChildCount; i++) {
            const c = p.namedChild(i);
            if (c?.type === 'identifier')
                this.def(c, acc);
            else if (c)
                this.defParam(c, acc);
        }
    }
    resolve(nameNode) {
        const name = nameNode.text;
        const idx = this.table.get(name);
        if (idx !== undefined)
            return idx;
        let s = this.synthetic.get(name);
        if (s === undefined) {
            s = this.bindings.length;
            this.synthetic.set(name, s);
            this.bindings.push({ name, declLine: 0, declColumn: 0, kind: 'module', synthetic: true });
        }
        return s;
    }
    def(nameNode, acc) {
        if (nameNode.text === '_')
            return;
        if (this.conditionalDepth > 0)
            acc.addMayDef(this.resolve(nameNode));
        else
            acc.addDef(this.resolve(nameNode));
    }
    use(nameNode, acc) {
        if (nameNode.text === '_')
            return;
        // Resolve only known LOCAL names; an unknown bare identifier is a method
        // call (resolves to a `module` synthetic — never a false local).
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
     * Def each identifier leaf of an assignment / loop target; route non-local
     * targets (`@x`, index/attribute writes) to the value walk (root is a use).
     */
    defTargets(target, acc) {
        const t = target.type;
        if (t === 'identifier') {
            this.def(target, acc);
            return;
        }
        if (t === 'left_assignment_list') {
            for (let i = 0; i < target.namedChildCount; i++) {
                const c = target.namedChild(i);
                if (c)
                    this.defTargets(c, acc);
            }
            return;
        }
        if (t === 'splat_parameter' || t === 'rest_assignment') {
            const id = target.namedChildren.find((c) => c.type === 'identifier');
            if (id)
                this.def(id, acc);
            else
                this.walkValue(target, acc);
            return;
        }
        // instance/class/global var, constant, element/attribute target — uses only.
        this.walkValue(target, acc);
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
            // Non-local variables and constants — recorded as neither a scalar def nor
            // a local use (they are not function-scoped locals); nothing to add.
            case 'instance_variable':
            case 'class_variable':
            case 'global_variable':
            case 'constant':
            case 'self':
                return;
            case 'assignment': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                // Register result-defs BEFORE walking the value so the nested call site
                // (reached during the value walk) carries them — single plain-identifier
                // target only (`x = f()`); a multi-target / `@ivar` / index LHS attaches
                // nothing (the per-target mapping is ambiguous).
                if (left?.type === 'identifier' && right)
                    this.registerResultDefs(right, [left]);
                if (right)
                    this.walkValue(right, acc);
                if (left)
                    this.defTargets(left, acc);
                return;
            }
            case 'operator_assignment': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                if (right)
                    this.walkValue(right, acc);
                if (left) {
                    if (left.type === 'identifier') {
                        this.use(left, acc);
                        this.def(left, acc);
                    }
                    else {
                        this.walkValue(left, acc); // non-local lvalue — use only
                    }
                }
                return;
            }
            case 'binary': {
                // `a && b` / `a || b` / `and` / `or` — the right operand is conditionally
                // evaluated, so any def inside it is a may-def; uses are still recorded.
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                const op = node.childForFieldName('operator')?.text ?? '';
                if (left)
                    this.walkValue(left, acc);
                if (right) {
                    if (op === '&&' || op === '||' || op === 'and' || op === 'or') {
                        this.conditional(() => this.walkValue(right, acc));
                    }
                    else {
                        this.walkValue(right, acc);
                    }
                }
                return;
            }
            case 'call':
                // `recv.meth(args)` / `meth(args)` / `puts x` / `obj.field` — every Ruby
                // call shape. Records a taint site (callee path, receiver, per-arg
                // occurrences, result defs, spread) plus the SAME uses the old default
                // descent recorded (receiver chain root + arguments). A nested block
                // child is its OWN function CFG (opaque — the `block` field is not walked).
                this.visitCall(node, acc);
                return;
            default:
                for (let i = 0; i < node.namedChildCount; i++) {
                    const c = node.namedChild(i);
                    if (c)
                        this.walkValue(c, acc);
                }
        }
    }
    // ── taint-site harvest ────────────────────────────────────────────────────
    /**
     * When `value` is a `call`, remember that call site should carry `resultDefs`
     * — the binding indices of `targets` (def-position identifiers). Consumed by
     * {@link visitCall} once the value walk reaches the node. Single plain-identifier
     * target only (the caller restricts to it); the blank target (`_`) binds nothing
     * and is skipped.
     */
    registerResultDefs(value, targets) {
        if (value.type !== 'call')
            return;
        const defs = [];
        for (const target of targets) {
            if (target.type !== 'identifier' || target.text === '_')
                continue;
            defs.push(this.resolve(target));
        }
        if (defs.length > 0)
            this.resultDefTargets.set(value.id, defs);
    }
    /**
     * Explicit `call` handler. Records a call site (callee path, receiver, per-arg
     * occurrence entries, result defs, spread marker) while reproducing EXACTLY the
     * uses the old default descent recorded (receiver chain root + arguments). Ruby
     * has no `new` — every site is `kind: 'call'`. The `at` anchor is the `call`
     * node's start, byte-aligned with the `@reference.call.free/.member` CALLS
     * anchor (which captures the whole `call` node), so the resolved-id join lands
     * by exact position (see file header ANCHOR ALIGNMENT).
     */
    visitCall(node, acc) {
        const receiver = node.childForFieldName('receiver');
        const method = node.childForFieldName('method');
        const args = node.childForFieldName('arguments');
        const siteIdx = acc.openCallSite('call', [
            node.startPosition.row + 1,
            node.startPosition.column,
        ]);
        acc.pushFrame(siteIdx);
        if (receiver) {
            // Member / chained call (`obj.method`, `a.b.c`, `obj&.m`). Walk the receiver
            // chain to its root binding (the receiver use + any mid-chain member reads)
            // and build the dotted callee path `root.…​.method`.
            const chain = this.walkReceiverChain(receiver, acc);
            if (chain.rootIdx !== undefined)
                acc.setSiteReceiver(siteIdx, chain.rootIdx);
            const path = this.calleePath(chain.path, method);
            if (path !== undefined)
                acc.setSiteCallee(siteIdx, path);
        }
        else if (method) {
            // Free / implicit-receiver call (`foo(a)`, `puts x`, `attr_accessor :x`).
            // The method NAME is a statement-level use (a known local resolves to its
            // binding, an unknown method to a `module` synthetic) but NOT a value
            // occurrence in any enclosing argument.
            if (method.text !== '_')
                acc.addUseWithoutOccurrence(this.resolve(method));
            acc.setSiteCallee(siteIdx, method.text);
        }
        const resultDefs = this.resultDefTargets.get(node.id);
        if (resultDefs !== undefined)
            acc.setSiteResultDefs(siteIdx, resultDefs);
        if (args)
            this.walkArguments(args, siteIdx, acc);
        acc.popFrame();
    }
    /**
     * Walk a member-call receiver, returning the chain ROOT binding (recorded as a
     * use) and the dotted prefix path (`a.b` in `a.b.c()`), plus a member-read site
     * for each NON-final access in the chain. A receiver that is itself a `call`
     * (Ruby nests `a.b.c` as `call(call(a,b),c)`) recurses; a bare identifier root
     * is the receiver binding; a `self` / non-identifier root has no static path.
     */
    walkReceiverChain(receiver, acc) {
        // Collect the access names along the receiver chain (outermost-last), and the
        // chain root node, by unwinding nested `call` receivers.
        const accesses = [];
        let cur = receiver;
        for (;;) {
            if (cur.type === 'call' && cur.childForFieldName('arguments') === null) {
                // A no-args member `call` in receiver position is a member ACCESS
                // (`a.b` in `a.b.c`) — its method name extends the path; recurse on its
                // own receiver. A receiver `call` WITH arguments is an opaque call result
                // (`foo(a).bar` — handled by the `else` below as a nested call site).
                const m = cur.childForFieldName('method');
                const inner = cur.childForFieldName('receiver');
                accesses.unshift(m?.text ?? '');
                if (!inner)
                    break;
                cur = inner;
                continue;
            }
            break;
        }
        let rootIdx;
        let rootSegment;
        if (cur.type === 'identifier' && cur.text !== '_') {
            rootIdx = this.resolve(cur);
            acc.addUse(rootIdx);
            rootSegment = cur.text;
        }
        else {
            // `self` / `@ivar` / a call-rooted receiver (`foo(a).bar`) / literal — walk
            // for uses + nested sites; no static root segment.
            this.walkValue(cur, acc);
        }
        // The INNERMOST access (`a.b` in `a.b.c()`) is a value-position member read;
        // the trailing access (the receiver's own method) is part of the callee path,
        // not a separate read.
        if (rootIdx !== undefined && accesses.length >= 1) {
            acc.addMemberRead(rootIdx, accesses[0]);
        }
        const path = rootSegment !== undefined && accesses.every((a) => a !== '')
            ? [rootSegment, ...accesses].join('.')
            : undefined;
        return { rootIdx, path };
    }
    /** Dotted callee path `prefix.method` (or undefined when the prefix is opaque). */
    calleePath(prefix, method) {
        const m = method?.text;
        if (m === undefined || m.length === 0)
            return undefined;
        if (prefix === undefined)
            return undefined;
        return `${prefix}.${m}`;
    }
    /**
     * Walk an `argument_list`, tagging each positional / keyword / splat argument's
     * occurrence position. A `pair` (`k: v`) records only the VALUE occurrence (the
     * `hash_key_symbol` key is not a use). A `splat_argument` (`*xs`) /
     * `hash_splat_argument` (`**kw`) marks the first spread position so the matcher
     * degrades soundly; its inner value still walks. A `block_argument` (`&blk`)
     * passes a block — its inner value is a use occurrence.
     */
    walkArguments(args, siteIdx, acc) {
        let pos = 0;
        for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i);
            if (!arg || arg.type === 'comment')
                continue;
            acc.setFrameArg(pos);
            if (arg.type === 'splat_argument' || arg.type === 'hash_splat_argument') {
                acc.setSiteSpread(siteIdx, pos);
                const inner = arg.namedChild(0);
                if (inner)
                    this.walkValue(inner, acc);
            }
            else if (arg.type === 'pair') {
                // `k: v` — only the value is an occurrence; the symbol key is not a use.
                const value = arg.childForFieldName('value') ?? arg.namedChild(arg.namedChildCount - 1);
                if (value)
                    this.walkValue(value, acc);
            }
            else {
                // Positional arg, `block_argument` (`&blk`), or a nested expression.
                this.walkValue(arg, acc);
            }
            pos++;
        }
    }
}
