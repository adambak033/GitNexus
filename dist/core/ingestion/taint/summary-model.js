/**
 * Per-function taint SUMMARY model (#2084 M4 U2).
 *
 * A {@link FunctionSummary} is the compact, context-insensitive abstraction of
 * one function's taint behaviour — the input to the interprocedural fixpoint
 * (`interproc-solver.ts`). It is the GitNexus analogue of Pysa's `.pysa`
 * models, Mariana Trench's "propagations", and CodeQL Models-as-Data summary
 * rows: a function is reduced to how taint enters (params / generated sources),
 * how it moves through (param→return, param→callee-arg), and where it lands
 * (param→sink). The fixpoint composes these across resolved `CALLS` edges so a
 * source in one function reaches a sink in another.
 *
 * ## Why summaries (not whole-program IFDS)
 *
 * The functional/summary method (Sharir-Pnueli 1981) analyses each function
 * ONCE and propagates the result over the call graph — the same shape Pysa,
 * Mariana Trench, and Infer use in production. GitNexus already resolves the
 * call graph (`CALLS` edges carry final node ids), so the summary IS the only
 * new artifact; propagation is graph reachability over a finite lattice.
 *
 * ## Granularity (first cut)
 *
 * WHOLE-PARAMETER. Ports are `param i`, `return`, and `receiver` — no field
 * access paths (`arg0.field.sub`). Field sensitivity, callback-parameter ports
 * (`Argument[0].Parameter[0]`), and context sensitivity are deferred (plan
 * KTD; the largest JS/TS FN class — closures — stays a documented gap).
 *
 * ## Plain-data discipline
 *
 * A summary is a JSON-plain value type (no functions, class instances, Maps, or
 * Symbols) so it survives `RunScopeResolutionStats` → `ScopeResolutionOutput`
 * threading and any future worker/cache boundary unchanged — the same
 * `Cloneable` constraint the CFG side channel obeys.
 */
/** Stable FNV-1a 32-bit hash → 8-char hex. Pure, deterministic, no deps. */
function fnv1a(input) {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        // 32-bit FNV prime multiply via shifts (avoids BigInt; stays in int32 land).
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}
/**
 * Deterministic digest of a summary's OWN taint facts (everything except
 * `version`, which is derived). Order-independent within each edge category —
 * the harvester already sorts, but the digest re-canonicalises so a reordering
 * never changes the stamp. Used as the leaf of {@link summaryVersion}.
 */
export function ownFactsDigest(s) {
    const parts = [`p${s.paramCount}`];
    parts.push(...s.paramToReturn
        .map((r) => `r:${r.param}:${[...(r.neutralized ?? [])].sort().join(',')}`)
        .sort());
    parts.push(...s.paramToCallArg
        .map((c) => `c:${c.param}:${c.callLine}:${c.argIndex}:${c.calleeName ?? ''}:${[...(c.neutralized ?? [])].sort().join(',')}`)
        .sort());
    parts.push(...s.paramToSink.map((k) => `k:${k.param}:${k.sinkKind}`).sort());
    parts.push(...s.sourceToReturn.map((g) => `g:${g.sourceKind}`).sort());
    parts.push(...s.sourceToCallArg
        .map((g) => `s:${g.sourceKind}:${g.callLine}:${g.argIndex}:${g.calleeName ?? ''}:${[...(g.neutralized ?? [])].sort().join(',')}`)
        .sort());
    parts.push(...s.callResults
        .map((cr) => {
        const d = cr.dest;
        const dest = d.to === 'sink'
            ? `sink:${d.sinkKind}`
            : d.to === 'return'
                ? 'return'
                : `arg:${d.toCallee ?? ''}:${d.argIndex}`;
        return `cr:${cr.calleeName}:${dest}`;
    })
        .sort());
    return fnv1a(parts.join('|'));
}
/**
 * Content version stamp for a summary: `hash(ownFactsDigest ∪ sorted callee
 * versions)`. Order-independent over callee versions (sorted). Equal iff the
 * function's own facts AND every callee dependency are unchanged — this is the
 * incremental invalidation primitive (a changed callee changes its version,
 * which changes every transitive caller's version).
 */
export function summaryVersion(ownDigest, calleeVersions) {
    return fnv1a(`${ownDigest}#${[...calleeVersions].sort().join(',')}`);
}
