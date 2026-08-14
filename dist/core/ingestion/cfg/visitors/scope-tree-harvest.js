/**
 * Abstract base owning the lexical scope tree + the two-phase resolution
 * substrate. Subclasses provide the per-language constructor wiring (param /
 * receiver declaration + the body `prescan` kick-off) and the abstract
 * `prescan`; Go additionally overrides `declare` / `def` / `use` for its `_`
 * blank-identifier semantics.
 */
export class ScopeTreeHarvester {
    fnNode;
    bindings = [];
    scopeByNode = new Map();
    root = { parent: null, table: new Map() };
    synthetic = new Map();
    fnId;
    /** Innermost enclosing scope per visited node id (prescan-filled) — O(scope-chain) phase-2 resolution. */
    nearestScopeCache = new Map();
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    conditionalDepth = 0;
    /**
     * Call/new node id → bindings whose declaration/assignment VALUE is exactly
     * that call (#2195 U6). Registered before the value walk, consumed by the
     * language harvester's `visitCall` (mirrors the TS harvester's
     * `resultDefTargets`).
     */
    resultDefTargets = new Map();
    constructor(fnNode) {
        this.fnNode = fnNode;
        this.fnId = fnNode.id;
        this.scopeByNode.set(fnNode.id, this.root);
    }
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable() {
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
    declare(nameNode, kind, scope) {
        const name = nameNode.text;
        if (!name || scope.table.has(name))
            return;
        scope.table.set(name, this.bindings.length);
        this.bindings.push({
            name,
            declLine: nameNode.startPosition.row + 1,
            declColumn: nameNode.startPosition.column,
            kind,
        });
    }
    // ── phase 2: per-statement fact extraction ───────────────────────────────
    resolve(nameNode) {
        const name = nameNode.text;
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
}
