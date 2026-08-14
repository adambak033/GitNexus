import { CallSiteFactAccumulator as FactAccumulator, finalizeChain } from './call-site-harvest.js';
/** Node types that own a nested CFG — their subtrees are opaque to harvesting. */
const NESTED_FUNCTION_TYPES = new Set(['function_item', 'closure_expression']);
/** Pattern containers whose identifier leaves are binding targets. */
const PATTERN_CONTAINER_TYPES = new Set([
    'tuple_pattern',
    'slice_pattern',
    'or_pattern',
    'reference_pattern',
]);
export class RustHarvester {
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
     * assigned to (`let x = f()` / `x = g()` ⇒ `[x]`). Populated just before the
     * value walk reaches the call (see {@link registerResultDefs}) and consumed by
     * {@link visitCall}. Mirrors the Swift / Kotlin / Go / Python harvesters' map.
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
    /** The function/closure body node (a `block` for a fn, block-or-expr for a closure). */
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
    /** Declare every parameter binder of a fn / closure (incl. `mut`, typed). */
    declareParams(fnNode) {
        const params = fnNode.childForFieldName('parameters') ??
            fnNode.namedChildren.find((c) => c.type === 'parameters' || c.type === 'closure_parameters');
        if (!params)
            return;
        for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i);
            if (!p)
                continue;
            if (p.type === 'parameter') {
                const pat = p.childForFieldName('pattern');
                if (pat)
                    this.declarePattern(pat, 'param');
            }
            else if (p.type === 'self_parameter') {
                // `&self` / `self` — bind `self` so reads of it resolve to a real
                // binding rather than a synthetic module name.
                const id = p.namedChildren.find((c) => c.type === 'self');
                if (id)
                    this.declare(id, 'param');
            }
            else if (p.type === 'identifier') {
                // Bare closure param `|x|`.
                this.declare(p, 'param');
            }
            else {
                // Typed closure param without the `parameter` wrapper, etc.
                this.declarePattern(p, 'param');
            }
        }
    }
    /**
     * Pre-scan the function body once, declaring every bound name. Recurses into
     * compound expressions but NOT into nested `function_item` / `closure_expression`
     * bodies (opaque).
     */
    prescan(node) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId)
            return;
        switch (t) {
            case 'let_declaration': {
                const pat = node.childForFieldName('pattern');
                if (pat)
                    this.declarePattern(pat, 'let');
                break;
            }
            case 'for_expression': {
                const pat = node.childForFieldName('pattern');
                if (pat)
                    this.declarePattern(pat, 'let');
                break;
            }
            case 'let_condition': {
                // `if let PAT = …` / `while let PAT = …`.
                const pat = node.childForFieldName('pattern');
                if (pat)
                    this.declarePattern(pat, 'let');
                break;
            }
            case 'match_arm': {
                const pat = node.childForFieldName('pattern');
                if (pat)
                    this.declarePattern(pat, 'let');
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
     * Declare every identifier leaf of a binding pattern. Handles the full Rust
     * pattern taxonomy: tuple / slice / struct / tuple-struct / ref / mut /
     * captured (`@`) / or patterns. A `tuple_struct_pattern`'s `type` field is the
     * variant PATH (`Some`, `Ok`) — not a binding; only its inner patterns bind.
     * `_`, literals and range patterns bind nothing.
     */
    declarePattern(pat, kind) {
        const t = pat.type;
        if (t === 'identifier') {
            this.declare(pat, kind);
            return;
        }
        if (t === '_')
            return; // standalone wildcard pattern is the `_` node
        if (t === 'match_pattern') {
            // The arm pattern wrapper — declare its (non-guard) sub-patterns. The
            // guard `if cond` is a value test, not a binder.
            const guard = pat.childForFieldName('condition');
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c && c.id !== guard?.id)
                    this.declarePattern(c, kind);
            }
            return;
        }
        if (PATTERN_CONTAINER_TYPES.has(t)) {
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c)
                    this.declarePattern(c, kind);
            }
            return;
        }
        if (t === 'tuple_struct_pattern') {
            // `Some(n)` / `Ok(v)` — the `type` field is the variant path (not a binder);
            // every other named child is an inner binding pattern.
            const typeNode = pat.childForFieldName('type');
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c && c.id !== typeNode?.id)
                    this.declarePattern(c, kind);
            }
            return;
        }
        if (t === 'struct_pattern') {
            // `Point { x, y }` — each `field_pattern` binds; shorthand `x` binds `x`,
            // `x: pat` binds `pat`'s leaves. The `type` field is the struct path.
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (!c)
                    continue;
                if (c.type === 'field_pattern') {
                    this.declareFieldPattern(c, kind);
                }
                else if (c.type === 'shorthand_field_identifier') {
                    this.declare(c, kind);
                }
            }
            return;
        }
        if (t === 'ref_pattern' || t === 'mut_pattern' || t === 'reference_pattern') {
            // `ref r` / `mut m` / `&p` — unwrap to the inner pattern.
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c && c.type !== 'mutable_specifier')
                    this.declarePattern(c, kind);
            }
            return;
        }
        if (t === 'captured_pattern') {
            // `v @ subpat` — `v` binds AND the subpattern's leaves bind.
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c)
                    this.declarePattern(c, kind);
            }
            return;
        }
        // range_pattern / literal patterns / scoped paths bind nothing.
    }
    /** `field_pattern` — shorthand `x` binds `x`; `x: pat` binds `pat`'s leaves. */
    declareFieldPattern(field, kind) {
        const name = field.childForFieldName('name');
        const pattern = field.childForFieldName('pattern');
        if (pattern) {
            this.declarePattern(pattern, kind);
            return;
        }
        if (name && name.type === 'shorthand_field_identifier') {
            this.declare(name, kind);
            return;
        }
        // Fallback: declare any identifier / shorthand leaf.
        for (let i = 0; i < field.namedChildCount; i++) {
            const c = field.namedChild(i);
            if (c?.type === 'shorthand_field_identifier' || c?.type === 'identifier')
                this.declare(c, kind);
        }
    }
    // ── phase 2: per-statement fact extraction ───────────────────────────────
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node) {
        const acc = new FactAccumulator(node.startPosition.row + 1);
        this.walkValue(node, acc);
        return acc.finish();
    }
    /** Facts for an expression whose WHOLE evaluation is conditional (guards/tests). */
    factsConditional(node) {
        const acc = new FactAccumulator(node.startPosition.row + 1);
        this.conditional(() => this.walkValue(node, acc));
        return acc.finish();
    }
    /**
     * Facts for a `for PAT in ITER` head: the loop pattern's leaves are defs, the
     * iterated expression a use.
     */
    forHeadFacts(stmt) {
        const acc = new FactAccumulator(stmt.startPosition.row + 1);
        const value = stmt.childForFieldName('value');
        const pat = stmt.childForFieldName('pattern');
        if (value)
            this.walkValue(value, acc);
        if (pat)
            this.defPattern(pat, acc);
        return acc.finish();
    }
    /**
     * Facts for ONLY a `let_declaration`'s PATTERN bindings (no value walk) — used
     * when the value is a control-flow expression already harvested by the visitor,
     * so the binding defs land on a separate continuation block without
     * double-counting the value's uses.
     */
    letPatternFacts(stmt) {
        const acc = new FactAccumulator(stmt.startPosition.row + 1);
        const pat = stmt.childForFieldName('pattern');
        if (pat)
            this.defPattern(pat, acc);
        return acc.finish();
    }
    /**
     * Facts for a `let PAT = VALUE` condition (`if let` / `while let`): the value
     * is a use, the pattern's leaves are defs. When `conditional` is true the defs
     * become may-defs (a `while let` re-test may not bind on the exit iteration).
     */
    letConditionFacts(cond, conditional) {
        const acc = new FactAccumulator(cond.startPosition.row + 1);
        const run = () => {
            const value = cond.childForFieldName('value');
            const pat = cond.childForFieldName('pattern');
            if (value)
                this.walkValue(value, acc);
            if (pat)
                this.defPattern(pat, acc);
        };
        if (conditional)
            this.conditional(run);
        else
            run();
        return acc.finish();
    }
    /**
     * Facts for a `match` arm's PATTERN bindings (#2206): `Some(n) => …` binds `n`
     * from the matched subject. The bindings are MAY-defs (only the arm that
     * actually matches binds; a later arm tests only when earlier ones didn't) and
     * are attached to the dispatch block, co-located with the subject's use, so a
     * tainted subject can propagate to the arm binding. The guard is skipped by
     * {@link defPattern}'s `match_pattern` handling. `undefined` when the pattern
     * binds nothing (`_`, a literal, a unit variant).
     */
    matchArmPatternFacts(arm) {
        const acc = new FactAccumulator(arm.startPosition.row + 1);
        const pat = arm.childForFieldName('pattern');
        if (pat)
            this.conditional(() => this.defPattern(pat, acc));
        return acc.defCount() ? acc.finish() : undefined;
    }
    /** ENTRY-block facts for the parameters (defs only — incl. default-position uses). */
    paramFacts() {
        const params = this.fnNode.childForFieldName('parameters') ??
            this.fnNode.namedChildren.find((c) => c.type === 'parameters' || c.type === 'closure_parameters');
        if (!params)
            return undefined;
        const acc = new FactAccumulator(this.fnNode.startPosition.row + 1);
        for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i);
            if (!p)
                continue;
            if (p.type === 'parameter') {
                const pat = p.childForFieldName('pattern');
                if (pat)
                    this.defPattern(pat, acc);
            }
            else if (p.type === 'self_parameter') {
                const id = p.namedChildren.find((c) => c.type === 'self');
                if (id)
                    this.def(id, acc);
            }
            else if (p.type === 'identifier') {
                this.def(p, acc);
            }
            else {
                this.defPattern(p, acc);
            }
        }
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
    /**
     * Def each identifier leaf of a binding pattern (the def-position analogue of
     * {@link declarePattern}). A `tuple_struct_pattern`'s `type` field path is a
     * variant name, not a def; its inner patterns bind. A struct field shorthand
     * binds; `_` binds nothing.
     */
    defPattern(pat, acc) {
        const t = pat.type;
        if (t === 'identifier') {
            this.def(pat, acc);
            return;
        }
        if (t === '_')
            return; // standalone wildcard pattern is the `_` node
        if (t === 'match_pattern') {
            const guard = pat.childForFieldName('condition');
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c && c.id !== guard?.id)
                    this.defPattern(c, acc);
            }
            return;
        }
        if (PATTERN_CONTAINER_TYPES.has(t)) {
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c)
                    this.defPattern(c, acc);
            }
            return;
        }
        if (t === 'tuple_struct_pattern') {
            const typeNode = pat.childForFieldName('type');
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c && c.id !== typeNode?.id)
                    this.defPattern(c, acc);
            }
            return;
        }
        if (t === 'struct_pattern') {
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (!c)
                    continue;
                if (c.type === 'field_pattern')
                    this.defFieldPattern(c, acc);
                else if (c.type === 'shorthand_field_identifier')
                    this.def(c, acc);
            }
            return;
        }
        if (t === 'ref_pattern' || t === 'mut_pattern' || t === 'reference_pattern') {
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c && c.type !== 'mutable_specifier')
                    this.defPattern(c, acc);
            }
            return;
        }
        if (t === 'captured_pattern') {
            for (let i = 0; i < pat.namedChildCount; i++) {
                const c = pat.namedChild(i);
                if (c)
                    this.defPattern(c, acc);
            }
            return;
        }
        // range / literal / scoped path — binds nothing.
    }
    defFieldPattern(field, acc) {
        const name = field.childForFieldName('name');
        const pattern = field.childForFieldName('pattern');
        if (pattern) {
            this.defPattern(pattern, acc);
            return;
        }
        if (name && name.type === 'shorthand_field_identifier') {
            this.def(name, acc);
            return;
        }
        for (let i = 0; i < field.namedChildCount; i++) {
            const c = field.namedChild(i);
            if (c?.type === 'shorthand_field_identifier' || c?.type === 'identifier')
                this.def(c, acc);
        }
    }
    /** Value-position walk: collect uses; route def positions to the pattern handler. */
    walkValue(node, acc) {
        const t = node.type;
        if (NESTED_FUNCTION_TYPES.has(t) && node.id !== this.fnId)
            return; // opaque
        switch (t) {
            case 'identifier':
                this.use(node, acc);
                return;
            case 'let_declaration': {
                const value = node.childForFieldName('value');
                const pat = node.childForFieldName('pattern');
                const alt = node.childForFieldName('alternative'); // `let … else { … }`
                // Register result-defs BEFORE the value walk so the call the walk reaches
                // carries them — single plain-identifier pattern only (`let x = f()`); a
                // destructuring `let (a, b) = …` attaches nothing (ambiguous mapping).
                if (value && pat && pat.type === 'identifier')
                    this.registerResultDefs(value, [pat]);
                if (value)
                    this.walkValue(value, acc);
                if (alt)
                    this.walkValue(alt, acc);
                if (pat)
                    this.defPattern(pat, acc);
                return;
            }
            case 'let_condition': {
                const value = node.childForFieldName('value');
                const pat = node.childForFieldName('pattern');
                if (value)
                    this.walkValue(value, acc);
                if (pat)
                    this.defPattern(pat, acc);
                return;
            }
            case 'assignment_expression': {
                const left = node.childForFieldName('left');
                const right = node.childForFieldName('right');
                // A plain `x = f(a)` attaches `resultDefs: [x]`; a field/index lvalue does
                // not (no scalar target).
                if (right && left && left.type === 'identifier')
                    this.registerResultDefs(right, [left]);
                if (right)
                    this.walkValue(right, acc);
                if (left) {
                    if (left.type === 'identifier') {
                        this.def(left, acc);
                    }
                    else {
                        // field / index lvalue (`obj.f = …`, `a[i] = …`) — root is a use only.
                        this.walkValue(left, acc);
                    }
                }
                return;
            }
            case 'compound_assignment_expr': {
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
                        this.walkValue(left, acc);
                    }
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
                // A Rust call (`foo(a)`, `a.method(x)`, `Foo::bar(x)`, `foo::<T>(x)`).
                // Records a taint site (callee path, receiver, per-arg occurrences, result
                // defs) while reproducing the uses the old default descent recorded. Rust
                // has no `new` — every site is `kind: 'call'`.
                this.visitCall(node, acc);
                return;
            case 'struct_expression':
                // A Rust struct literal (`Point { x: 1 }`, `mymod::Point { .. }`,
                // `Foo::<T> { .. }`). The Rust CALLS query tags it
                // `@reference.call.constructor`, so it resolves to a constructor id — we
                // record a `kind: 'new'` site (callee = the struct type path) so that id
                // joins into `calleeIds`. Field-init VALUES walk for uses/occurrences.
                this.visitStruct(node, acc);
                return;
            case 'field_expression': {
                // `a.b` value read — the chain-root identifier is a use plus at most one
                // member-read site (the innermost access); the field name is not a scalar
                // binding. Mirrors the Swift / Kotlin / Go value-position member-read
                // semantics.
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
    // ── taint-site harvest ───────────────────────────────────────────────────
    /**
     * When `value`'s root (after unwrapping a `try_expression`) is a
     * `call_expression`, remember that call site should carry `resultDefs` — the
     * binding indices of `targets` (def-position identifiers). Consumed by
     * {@link visitCall} once the value walk reaches the node. Single-target only;
     * the blank target (`_`) binds nothing.
     */
    registerResultDefs(value, targets) {
        const root = this.unwrapValue(value);
        if (root.type !== 'call_expression')
            return;
        const defs = [];
        for (const target of targets) {
            if (target.type !== 'identifier' || target.text === '_')
                continue;
            defs.push(this.resolve(target));
        }
        if (defs.length > 0)
            this.resultDefTargets.set(root.id, defs);
    }
    /** Strip a `try_expression` (`expr?`) / `await_expression` wrapper around a value. */
    unwrapValue(node) {
        let n = node;
        let hops = 4;
        while ((n.type === 'try_expression' || n.type === 'await_expression') && hops-- > 0) {
            const inner = n.namedChild(0);
            if (!inner)
                break;
            n = inner;
        }
        return n;
    }
    /**
     * Open + populate a call site for a Rust `call_expression`. `node` IS the
     * `call_expression` — the SAME node the scope query anchors `@reference.call.*`
     * on (its `atRange`), so the resolved-id join lands by exact position (see file
     * header ANCHOR ALIGNMENT). A `call_expression` is always `kind: 'call'`; struct
     * literals (`kind: 'new'`) are harvested separately by {@link visitStruct}.
     */
    visitCall(node, acc) {
        const calleeNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');
        const siteIdx = acc.openCallSite('call', [
            node.startPosition.row + 1,
            node.startPosition.column,
        ]);
        acc.pushFrame(siteIdx);
        if (calleeNode)
            this.harvestCallee(calleeNode, siteIdx, acc);
        const resultDefs = this.resultDefTargets.get(node.id);
        if (resultDefs !== undefined)
            acc.setSiteResultDefs(siteIdx, resultDefs);
        if (argsNode) {
            let pos = 0;
            for (let i = 0; i < argsNode.namedChildCount; i++) {
                const arg = argsNode.namedChild(i);
                if (!arg || arg.type === 'line_comment' || arg.type === 'block_comment')
                    continue;
                acc.setFrameArg(pos);
                this.walkValue(arg, acc);
                pos++;
            }
        }
        acc.popFrame();
    }
    /**
     * Open + populate a `kind: 'new'` site for a Rust `struct_expression`
     * (`Point { x: 1 }`, `mymod::Point { .. }`, `Foo::<T> { .. }`). `node` IS the
     * `struct_expression` — the SAME node the Rust scope query anchors
     * `@reference.call.constructor` on (its `atRange`), so the resolved
     * constructor-id join lands by exact position. The `name` field of a
     * `struct_expression` is a `type_identifier` (`Point`), a
     * `scoped_type_identifier` (`mymod::Point`), or a `generic_type_with_turbofish`
     * (`Foo::<T>` / `mymod::Bar::<T>`); all three start at the SAME column as the
     * enclosing `struct_expression` (verified by a real parse), so the broadest-span
     * `@reference.call.constructor` anchor == the `struct_expression` start.
     *
     * The callee path joins the `::`-segments of the type with `.` (NOT `::`) so the
     * LEAF after the last separator is the tail (`mymod::Point` ⇒ `mymod.Point` ⇒
     * leaf `Point`), exactly the tail the CALLS query's `@reference.name` capture
     * resolves and the tail {@link import('../emit.js').calleesOfBlock} extracts via
     * `lastIndexOf('.')`. A type/module path head is never a value binding, so no
     * receiver (mirrors {@link harvestScopedCallee}). The field-init VALUES
     * (`field_initializer` `value`, shorthand `y`, base `..rest`) walk for
     * uses/occurrences; field NAMES are not uses.
     */
    visitStruct(node, acc) {
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');
        const siteIdx = acc.openCallSite('new', [
            node.startPosition.row + 1,
            node.startPosition.column,
        ]);
        acc.pushFrame(siteIdx);
        const path = nameNode ? this.structTypePath(nameNode) : undefined;
        if (path !== undefined)
            acc.setSiteCallee(siteIdx, path);
        if (bodyNode) {
            let pos = 0;
            for (let i = 0; i < bodyNode.namedChildCount; i++) {
                const field = bodyNode.namedChild(i);
                if (!field)
                    continue;
                if (field.type === 'field_initializer') {
                    // `x: VALUE` — the field NAME is not a use; only VALUE is walked.
                    const value = field.childForFieldName('value');
                    if (value) {
                        acc.setFrameArg(pos);
                        this.walkValue(value, acc);
                        pos++;
                    }
                }
                else if (field.type === 'shorthand_field_initializer') {
                    // `y` shorthand — the identifier IS a value use of the local `y`.
                    const id = field.namedChild(0);
                    if (id) {
                        acc.setFrameArg(pos);
                        this.walkValue(id, acc);
                        pos++;
                    }
                }
                else if (field.type === 'base_field_initializer') {
                    // `..rest` functional-update base — `rest` is a value use.
                    const baseExpr = field.namedChild(0);
                    if (baseExpr) {
                        acc.setFrameArg(pos);
                        this.walkValue(baseExpr, acc);
                        pos++;
                    }
                }
            }
        }
        acc.popFrame();
    }
    /**
     * Build the dotted type path of a `struct_expression`'s `name` field. The name
     * is a `type_identifier` (`Point`), a `scoped_type_identifier`
     * (`mymod::Point` — `path` + tail `name` type_identifier), or a
     * `generic_type_with_turbofish` (`Foo::<T>` / `mymod::Bar::<T>` — its `type`
     * field is a `type_identifier` or a `scoped_identifier`; the turbofish
     * `type_arguments` are dropped). Segments join with `.` so the leaf is the type
     * tail (matching the CALLS `@reference.name` tail capture). Returns `undefined`
     * when no segments could be read (defensive — keeps a mis-anchored site from
     * carrying a bogus callee).
     */
    structTypePath(nameNode) {
        const segments = [];
        const collect = (n) => {
            const t = n.type;
            if (t === 'type_identifier' || t === 'identifier') {
                segments.push(n.text);
                return;
            }
            if (t === 'generic_type_with_turbofish') {
                // `Foo::<T>` / `mymod::Bar::<T>` — descend the `type` field; the
                // `type_arguments` are not part of the resolved type path.
                const typeNode = n.childForFieldName('type');
                if (typeNode)
                    collect(typeNode);
                return;
            }
            if (t === 'scoped_type_identifier' || t === 'scoped_identifier') {
                // `mymod::Point` / `mymod::Bar` — head `path` then the tail `name`.
                const pathNode = n.childForFieldName('path');
                if (pathNode)
                    collect(pathNode);
                const tail = n.childForFieldName('name');
                if (tail)
                    collect(tail);
                return;
            }
        };
        collect(nameNode);
        return segments.length > 0 && segments.every((s) => s !== '') ? segments.join('.') : undefined;
    }
    /**
     * Record the callee path + receiver for a `call_expression`'s `function` node.
     * Free `identifier` (`foo`), method `field_expression` (`a.method`, receiver
     * root `a`), path `scoped_identifier` (`Foo::bar` ⇒ dotted `Foo.bar`, leaf
     * `bar`), and the turbofish `generic_function` (`foo::<T>` — unwrap the
     * `function` field and recurse). Anything else (a call-rooted chain `f()()`,
     * a parenthesized callable) walks for uses with no static callee path.
     */
    harvestCallee(calleeNode, siteIdx, acc) {
        const callee = this.unwrapValue(calleeNode);
        if (callee.type === 'identifier') {
            // A bare free call — the callee NAME is a statement-level use but NOT a
            // value occurrence in any enclosing argument.
            if (callee.text !== '_')
                acc.addUseWithoutOccurrence(this.resolve(callee));
            acc.setSiteCallee(siteIdx, callee.text);
            return;
        }
        if (callee.type === 'field_expression') {
            // skipFinalRead: the final `.field` IS the callee, carried by the path.
            const chain = this.walkChain(callee, acc, true);
            if (chain.path !== undefined)
                acc.setSiteCallee(siteIdx, chain.path);
            if (chain.rootIdx !== undefined)
                acc.setSiteReceiver(siteIdx, chain.rootIdx);
            return;
        }
        if (callee.type === 'scoped_identifier') {
            const scoped = this.harvestScopedCallee(callee, acc);
            if (scoped.path !== undefined)
                acc.setSiteCallee(siteIdx, scoped.path);
            if (scoped.rootIdx !== undefined)
                acc.setSiteReceiver(siteIdx, scoped.rootIdx);
            return;
        }
        if (callee.type === 'generic_function') {
            // `foo::<T>(x)` — the turbofish wraps the real callee in `function`.
            const inner = callee.childForFieldName('function');
            if (inner)
                this.harvestCallee(inner, siteIdx, acc);
            else
                this.walkValue(callee, acc);
            return;
        }
        // Call-rooted chains (`f()()`), parenthesized callables — walk for uses; no
        // static callee path.
        this.walkValue(callee, acc);
    }
    /**
     * Walk a `scoped_identifier` (`Foo::bar`, `a::b::c`) callee. The `::`-segments
     * are joined with `.` (NOT `::`) so the LEAF after the last separator is the
     * tail (`Foo::bar` ⇒ `Foo.bar` ⇒ leaf `bar`), matching the Rust CALLS query's
     * `@reference.name` tail capture and {@link
     * import('../emit.js').calleesOfBlock}'s `lastIndexOf('.')` leaf rule. The
     * receiver is set only when the head segment is a bound LOCAL (`a::b::c` with
     * `a` a local); a type / module head (`Foo`, `crate`) is no value binding.
     */
    harvestScopedCallee(node, acc) {
        const segments = [];
        let cur = node;
        for (;;) {
            if (cur.type === 'scoped_identifier') {
                const name = cur.childForFieldName('name');
                segments.unshift(name?.text ?? '');
                const path = cur.childForFieldName('path');
                if (!path)
                    break;
                cur = path;
            }
            else {
                // The head segment — a bare `identifier` (`a` / `Foo` / `crate`) or a
                // `crate`/`self`/`super`/`metavariable` keyword node.
                segments.unshift(cur.text);
                break;
            }
        }
        let rootIdx;
        // Only a head segment that is a bound LOCAL is a receiver (taint substrate);
        // a type / module path head launders no value.
        if (cur.type === 'identifier' && cur.text !== '_' && this.table.has(cur.text)) {
            rootIdx = this.resolve(cur);
            acc.addUse(rootIdx);
        }
        const path = segments.every((s) => s !== '') ? segments.join('.') : undefined;
        return { path, rootIdx };
    }
    /**
     * `field_expression` chain walk shared by value position and callee position.
     * Records the chain-root identifier as a use plus at most ONE member-read site
     * — the INNERMOST access — when the root is an identifier; `skipFinalRead`
     * suppresses it when that access is the callee (carried by the dotted path
     * instead). Mirrors the Swift / Kotlin / Go / Python harvesters' walkChain. A
     * non-identifier root (`self`/literal/call) launders no static path/receiver
     * but its uses + nested sites are still walked.
     */
    walkChain(node, acc, skipFinalRead) {
        const accesses = [];
        let cur = node;
        for (;;) {
            if (cur.type === 'field_expression') {
                const field = cur.childForFieldName('field');
                accesses.unshift(field?.text ?? '');
                const value = cur.childForFieldName('value');
                if (!value)
                    break;
                cur = value;
            }
            else {
                break;
            }
        }
        // The shared terminal: root-use record + innermost member-read + path-join.
        // The non-identifier root (`self.x.f()`, `foo().bar`, a tuple index) walks for
        // uses + nested sites.
        return finalizeChain(acc, cur, accesses, skipFinalRead, (t) => t === 'identifier', {
            resolve: (n) => this.resolve(n),
            walkRoot: (n) => this.walkValue(n, acc),
        });
    }
}
