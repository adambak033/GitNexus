const SITE_KINDS = new Set(['call', 'new', 'member-read']);
/**
 * Whether a structurally-valid CFG's M3 `sites` annotations are safe to feed
 * to the taint matcher/propagator. `true` when no statement carries sites
 * (pre-M3 channel, or no calls) — absence is the well-formed empty case.
 */
export const hasTaintSafeSites = (cfg) => {
    // Sites carry binding indices — a channel with sites but no binding table
    // has nothing to range-check them against: reject (checked per statement).
    const bindingCount = Array.isArray(cfg.bindings) ? cfg.bindings.length : -1;
    for (const block of cfg.blocks) {
        const stmts = block.statements;
        if (stmts === undefined)
            continue;
        if (!Array.isArray(stmts))
            return false;
        for (const s of stmts) {
            if (s?.sites === undefined)
                continue;
            if (bindingCount < 0)
                return false;
            if (!isSafeSiteList(s.sites, bindingCount))
                return false;
        }
    }
    return true;
};
const isSafeSiteList = (sites, bindingCount) => {
    if (!Array.isArray(sites))
        return false;
    const siteCount = sites.length;
    const bindingInRange = (i) => Number.isInteger(i) && i >= 0 && i < bindingCount;
    const siteInRange = (i) => Number.isInteger(i) && i >= 0 && i < siteCount;
    for (const site of sites) {
        if (site === null || typeof site !== 'object')
            return false;
        if (typeof site.kind !== 'string' || !SITE_KINDS.has(site.kind))
            return false;
        if (site.callee !== undefined && typeof site.callee !== 'string')
            return false;
        if (site.receiver !== undefined && !bindingInRange(site.receiver))
            return false;
        if (site.requireArg !== undefined && typeof site.requireArg !== 'string')
            return false;
        if (site.template !== undefined && typeof site.template !== 'boolean')
            return false;
        if (site.spread !== undefined &&
            (!Number.isInteger(site.spread) || site.spread < 0)) {
            return false;
        }
        if (site.parent !== undefined) {
            const p = site.parent;
            if (!Array.isArray(p) || p.length !== 2)
                return false;
            if (!siteInRange(p[0]))
                return false;
            if (!Number.isInteger(p[1]) || p[1] < 0)
                return false;
        }
        if (site.resultDefs !== undefined) {
            if (!Array.isArray(site.resultDefs) || !site.resultDefs.every(bindingInRange))
                return false;
        }
        if (site.args !== undefined) {
            if (!Array.isArray(site.args))
                return false;
            for (const position of site.args) {
                if (!Array.isArray(position))
                    return false;
                for (const entry of position) {
                    if (typeof entry === 'number') {
                        if (!bindingInRange(entry))
                            return false;
                    }
                    else if (Array.isArray(entry) && entry.length === 2) {
                        if (!bindingInRange(entry[0]) || !siteInRange(entry[1]))
                            return false;
                    }
                    else {
                        return false;
                    }
                }
            }
        }
        if (site.kind === 'member-read') {
            // The matcher dereferences both unconditionally on member reads.
            if (!bindingInRange(site.object) || typeof site.property !== 'string')
                return false;
        }
        else {
            if (site.object !== undefined && !bindingInRange(site.object))
                return false;
            if (site.property !== undefined && typeof site.property !== 'string')
                return false;
        }
    }
    return true;
};
