/**
 * Minimal ordered, deduplicating def/use collector for one statement record,
 * with NO call-site machinery (#2195 U7). The Kotlin / Python / Ruby / Rust /
 * Dart / Swift harvesters each carried a BYTE-IDENTICAL copy of this class:
 * those units harvest NO call sites (the taint substrate is a later step), so a
 * site-free accumulator keeps their emitted facts free of any `sites` key
 * (matching the Python harvester) and byte-identical to one another. This is the
 * no-site sibling of {@link CallSiteFactAccumulator}; `finish` omits `sites`
 * entirely. `useCount` is live (Ruby's emit guard is `defCount() ||
 * useCount()`).
 */
export class DefUseAccumulator {
    line;
    defs = [];
    uses = [];
    mayDefs = [];
    defSeen = new Set();
    useSeen = new Set();
    mayDefSeen = new Set();
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
    finish() {
        return {
            line: this.line,
            defs: this.defs,
            uses: this.uses,
            // Stay absent when empty — keeps the serialized side-channel payload lean.
            ...(this.mayDefs.length > 0 ? { mayDefs: this.mayDefs } : {}),
        };
    }
}
/**
 * Defensive per-statement cap on harvested taint `sites` (#2195 U11). A real
 * statement carries a handful of call / member-read sites; this only bounds a
 * pathological or machine-generated statement (e.g. hundreds of nested calls)
 * from producing an unbounded site list. Mirrors the PDG edge/fact caps' style
 * (a generous-but-finite limit, checked before each push). Overflow is silent
 * but observable via {@link CallSiteFactAccumulator.sitesTruncated}; the first
 * `DEFAULT_PDG_MAX_SITES_PER_STATEMENT` sites are kept fully intact (callee,
 * args, parent), the over-cap tail is dropped.
 */
export const DEFAULT_PDG_MAX_SITES_PER_STATEMENT = 512;
/**
 * Ordered, deduplicating def/use collector for one statement record, PLUS the
 * call-site harvest machinery (#2195 U6). A drop-in superset of the simple
 * def/use accumulator the C-family harvesters used before the substrate landed
 * — `addDef`/`addMayDef`/`addUse`/`defCount`/`useCount`/`finish` are unchanged,
 * so harvesters that never open a site emit byte-identical facts (no `sites`
 * key, since `finish` omits it when empty).
 */
export class CallSiteFactAccumulator {
    line;
    defs = [];
    uses = [];
    mayDefs = [];
    defSeen = new Set();
    useSeen = new Set();
    mayDefSeen = new Set();
    /** Taint sites recorded for this statement. */
    sites = [];
    /** Composite (object|property|parent) keys of recorded member-read sites — O(1) dedup. */
    memberReadKeys = new Set();
    /** Stack of open call/new sites — the occurrence fan-out targets. */
    frames = [];
    /** Set once the per-statement site cap is hit; over-cap sites are dropped. */
    _sitesTruncated = false;
    constructor(line) {
        this.line = line;
    }
    /** True iff this statement hit {@link DEFAULT_PDG_MAX_SITES_PER_STATEMENT}. */
    get sitesTruncated() {
        return this._sitesTruncated;
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
     * argument — bare callee names only (see each harvester's `visitCall`).
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
    // ── site machinery (#2195 U6, mirrors the TS harvester) ──────────────────
    /** `[defs.length, mayDefs.length]` marker for {@link defsSince}. */
    defSnapshot() {
        return [this.defs.length, this.mayDefs.length];
    }
    /** Binding indices def'd (must- OR may-) since the snapshot was taken. */
    defsSince(snap) {
        return [...this.defs.slice(snap[0]), ...this.mayDefs.slice(snap[1])];
    }
    /**
     * Open a call/new site; parent = innermost enclosing argument position.
     * Returns the new site index, or -1 when the per-statement site cap is hit
     * (the caller threads -1 through `pushFrame`/`setSite*`, all of which no-op on
     * a sentinel index — see {@link DEFAULT_PDG_MAX_SITES_PER_STATEMENT}).
     *
     * `at` is the call/new node's anchor position `[line (1-based), col (0-based)]`
     * — the SAME position the CALLS-edge resolution keys on (see
     * {@link SiteRecord.at} for the KTD7 alignment); the harvester passes its
     * `visitCall`/`visitNew` node's `startPosition` so the downstream resolved-id
     * join lands by exact position.
     */
    openCallSite(kind, at) {
        if (this.sites.length >= DEFAULT_PDG_MAX_SITES_PER_STATEMENT) {
            this._sitesTruncated = true;
            return -1;
        }
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
     * the enclosing sink-argument position (e.g. the non-value operands of a
     * comma expression — only the final operand's value flows).
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
        const site = this.sites[siteIdx];
        if (site)
            site.callee = callee;
    }
    setSiteReceiver(siteIdx, receiver) {
        const site = this.sites[siteIdx];
        if (site)
            site.receiver = receiver;
    }
    setSiteResultDefs(siteIdx, resultDefs) {
        const site = this.sites[siteIdx];
        if (site)
            site.resultDefs = [...resultDefs];
    }
    setSiteSpread(siteIdx, firstSpreadArg) {
        const site = this.sites[siteIdx];
        if (site && site.spread === undefined)
            site.spread = firstSpreadArg;
    }
    /**
     * Record a value-position member read. Exact duplicates within the statement
     * (same object/property/parent position) dedup; reads at DIFFERENT argument
     * positions stay distinct (`exec(req.body, req.body)` is two occurrences).
     */
    addMemberRead(object, property) {
        const parent = this.innermostArgPosition();
        const dedupKey = `${object}|${property}|${parent ? `${parent[0]}:${parent[1]}` : 'top'}`;
        if (this.memberReadKeys.has(dedupKey))
            return;
        if (this.sites.length >= DEFAULT_PDG_MAX_SITES_PER_STATEMENT) {
            this._sitesTruncated = true;
            return;
        }
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
     * Fan a binding occurrence out to every arg-active open frame, via-tagged
     * with the site of the IMMEDIATELY nested frame when one exists:
     * `exec(escape(x))` puts a plain `x` in escape's arg 0 and `[x, escapeIdx]`
     * in exec's arg 0 — the sanitizer-interposition substrate.
     */
    recordOccurrence(idx) {
        for (let i = this.frames.length - 1; i >= 0; i--) {
            const f = this.frames[i];
            if (f.argIdx < 0)
                continue;
            // A nested frame whose site was cap-dropped (siteIdx -1) is not a real via.
            const next = i + 1 < this.frames.length ? this.frames[i + 1].siteIdx : undefined;
            const via = next !== undefined && next >= 0 ? next : undefined;
            this.pushArgEntry(f.siteIdx, f.argIdx, idx, via);
        }
    }
    pushArgEntry(siteIdx, argIdx, bindingIdx, via) {
        const site = this.sites[siteIdx];
        if (!site)
            return; // cap-dropped frame (siteIdx -1) — no target to fan into
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
            // Optional fields stay absent when empty — keeps the serialized
            // side-channel payload lean (most statements have no may-defs / sites).
            ...(this.mayDefs.length > 0 ? { mayDefs: this.mayDefs } : {}),
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
/**
 * Shared `walkChain` TERMINAL (#2227 follow-up, plan KTD5/U8) — the byte-identical
 * post-unwind block the Go / Kotlin / Swift / Rust / Python harvesters all ran
 * after walking their grammar-specific access chain (`selector_expression` /
 * `navigation_expression` / `field_expression` / `attribute`) into an
 * `accesses: string[]` list and a resolved root node `cur`.
 *
 * It records the chain-root identifier as a use, emits at most ONE member-read
 * site — the INNERMOST access — when the root is an identifier (suppressed by
 * `skipFinalRead` when that access IS the callee, carried by the dotted path
 * instead), and builds the dotted path `[root, ...accesses].join('.')`. The only
 * per-grammar bit is the root identifier node type, supplied via `isRootIdType`
 * (`'identifier'` for Go/Rust/Python, `'simple_identifier'` for Kotlin/Swift);
 * the `resolve` / `walkRoot` callbacks bind the harvester's own methods. The
 * `addUse` / `addMemberRead` machinery is on the accumulator itself, so it is
 * called directly (no callback). Behavior is identical to the inlined terminals
 * this replaces — the per-language harvest tests are the characterization lock.
 */
export function finalizeChain(acc, cur, accesses, skipFinalRead, isRootIdType, hooks) {
    let rootIdx;
    let rootSegment;
    if (isRootIdType(cur.type) && cur.text !== '_') {
        rootIdx = hooks.resolve(cur);
        acc.addUse(rootIdx);
        rootSegment = cur.text;
    }
    else {
        hooks.walkRoot(cur);
    }
    const innermost = accesses[0];
    if (rootIdx !== undefined && innermost && !(skipFinalRead && accesses.length === 1)) {
        acc.addMemberRead(rootIdx, innermost);
    }
    const path = rootSegment !== undefined && accesses.every((a) => a !== '')
        ? [rootSegment, ...accesses].join('.')
        : undefined;
    return { path, rootIdx };
}
