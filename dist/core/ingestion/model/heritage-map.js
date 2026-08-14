/**
 * Heritage Map
 *
 * Unified inheritance data structure built from accumulated
 * {@link ExtractedHeritage} records **after all chunks complete** (between
 * chunk processing and call resolution). Consumes `ExtractedHeritage[]` and
 * resolves type names to nodeIds via `lookupClassByName`, NOT graph-edge
 * queries.
 *
 * Combines two concerns:
 * 1. **Parent/ancestor lookup** (MRO-aware method resolution)
 * 2. **Implementor lookup** (interface dispatch — which files contain
 *    classes implementing a given interface)
 */
import { getLanguageFromFilename } from '../../../_shared/index.js';
import { isDeferredResolutionProfileEnabled, logDeferredProfile, } from '../utils/deferred-resolution-profile.js';
/**
 * Determine whether a heritage.extends capture is actually an IMPLEMENTS
 * relationship. Consults the symbol table first (authoritative — Tier 1 /
 * Tier 2 resolution); falls back to the injected {@link HeritageResolutionStrategy}
 * heuristics for external symbols not present in the graph.
 */
export const resolveExtendsType = (parentName, currentFilePath, ctx, strategy) => {
    const resolved = ctx.resolve(parentName, currentFilePath);
    if (resolved && resolved.candidates.length > 0) {
        const isInterface = resolved.candidates[0].type === 'Interface';
        return isInterface
            ? { type: 'IMPLEMENTS', idPrefix: 'Interface' }
            : { type: 'EXTENDS', idPrefix: 'Class' };
    }
    // Unresolved symbol — fall back to strategy heuristics.
    if (strategy.interfaceNamePattern?.test(parentName)) {
        return { type: 'IMPLEMENTS', idPrefix: 'Interface' };
    }
    if (strategy.defaultEdge === 'IMPLEMENTS') {
        return { type: 'IMPLEMENTS', idPrefix: 'Interface' };
    }
    return { type: 'EXTENDS', idPrefix: 'Class' };
};
// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
/** Maximum ancestor chain depth to prevent runaway traversal. */
const MAX_ANCESTOR_DEPTH = 32;
/** Shared empty set returned when no implementors are found. */
const EMPTY_SET = new Set();
/** Default strategy used when `buildHeritageMap` is called without an
 *  explicit `getHeritageStrategy` callback — the fallback for a language
 *  whose provider sets no interface-name pattern and no non-default
 *  `heritageDefaultEdge`. */
const DEFAULT_HERITAGE_STRATEGY = { defaultEdge: 'EXTENDS' };
// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
/**
 * Build a HeritageMap from accumulated ExtractedHeritage records.
 *
 * Resolves class/interface/struct/trait names to nodeIds via
 * `ctx.model.types.lookupClassByName`. When a name resolves to multiple
 * candidates, all are recorded (partial-class / cross-file scenario).
 * Unresolvable names are silently skipped — a missing parent is better
 * than a wrong edge.
 *
 * Also builds the implementor index (interface name → implementing file
 * paths) used by interface-dispatch in call resolution.
 */
export const buildHeritageMap = (heritage, ctx, getHeritageStrategy) => {
    // childNodeId → insertion-ordered array of { parentId, kind }.
    // Ordered array (not Set) because Ruby MRO walk depends on declaration
    // order. A parallel `seen` map dedupes `(parentId, kind)` pairs without
    // losing order.
    const directParents = new Map();
    const seenParents = new Map();
    // interfaceName → Set<filePath>  (implementor lookup for interface dispatch)
    const implementorFiles = new Map();
    const profileHeritage = isDeferredResolutionProfileEnabled();
    let maxNameCartesian = 0;
    let ambiguousHeritageRecords = 0;
    let unresolvedChildLookups = 0;
    let unresolvedParentLookups = 0;
    for (const h of heritage) {
        // ── Parent lookup (nodeId-based) ────────────────────────────────
        const childDefs = ctx.model.types.lookupClassByName(h.className);
        const parentDefs = ctx.model.types.lookupClassByName(h.parentName);
        // Unresolved-side counters live in a separate guard so they observe
        // records the ambiguity block below skips. On JVM monorepos the
        // pathological fan-out case is precisely "many same-named children
        // with an unresolved external supertype" (or the inverse) — both
        // sides non-empty is the case `ambiguousHeritageRecords` already
        // covers; the unresolved cases were silently dropped from the
        // metric before this counter.
        if (profileHeritage) {
            if (childDefs.length === 0)
                unresolvedChildLookups++;
            if (parentDefs.length === 0)
                unresolvedParentLookups++;
        }
        if (profileHeritage && childDefs.length > 0 && parentDefs.length > 0) {
            const product = childDefs.length * parentDefs.length;
            if (product > 1)
                ambiguousHeritageRecords++;
            if (product > maxNameCartesian)
                maxNameCartesian = product;
        }
        if (childDefs.length > 0 && parentDefs.length > 0) {
            for (const child of childDefs) {
                for (const parent of parentDefs) {
                    // Skip self-references
                    if (child.nodeId === parent.nodeId)
                        continue;
                    let parents = directParents.get(child.nodeId);
                    if (!parents) {
                        parents = [];
                        directParents.set(child.nodeId, parents);
                    }
                    let seen = seenParents.get(child.nodeId);
                    if (!seen) {
                        seen = new Set();
                        seenParents.set(child.nodeId, seen);
                    }
                    // Dedup by `parentId + kind` so the same parent under two different
                    // kinds (e.g. a module that is both included and prepended — legal
                    // Ruby though unusual) is recorded twice; the consumer needs both
                    // kinds in the walk. A single (parent, kind) pair is deduped.
                    const key = `${parent.nodeId}|${h.kind}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        parents.push({ parentId: parent.nodeId, kind: h.kind });
                    }
                }
            }
        }
        // ── Implementor index (name-based) ──────────────────────────────
        //
        // Known limitation: Rust `kind: 'trait-impl'` entries are intentionally NOT
        // added to the implementor index. Interface dispatch resolution currently
        // does not traverse Rust trait objects, so recording them here would
        // inflate the index without a consumer. Revisit if/when trait-object
        // dispatch is added.
        //
        // Known limitation: `getImplementorFiles` is keyed by interface **name**
        // (string), so two interfaces with the same unqualified name in different
        // packages (e.g. `pkgA.IRepository` vs `pkgB.IRepository`) collide.
        let isImpl = false;
        if (h.kind === 'implements') {
            isImpl = true;
        }
        else if (h.kind === 'extends') {
            const lang = getLanguageFromFilename(h.filePath);
            if (lang) {
                const strategy = getHeritageStrategy?.(lang) ?? DEFAULT_HERITAGE_STRATEGY;
                const { type } = resolveExtendsType(h.parentName, h.filePath, ctx, strategy);
                isImpl = type === 'IMPLEMENTS';
            }
        }
        if (isImpl) {
            let files = implementorFiles.get(h.parentName);
            if (!files) {
                files = new Set();
                implementorFiles.set(h.parentName, files);
            }
            files.add(h.filePath);
        }
    }
    // --- Public API ---------------------------------------------------
    /** Internal helper: return the entries array (may be undefined). */
    const entriesFor = (nodeId) => directParents.get(nodeId);
    const getParentEntries = (childNodeId) => {
        const entries = entriesFor(childNodeId);
        return entries ?? [];
    };
    const getParents = (childNodeId) => {
        const entries = entriesFor(childNodeId);
        if (!entries)
            return [];
        // Deduplicate parent ids across kinds so the flat-string contract
        // (used by non-Ruby MRO strategies and by the C3 linearizer) stays
        // identical to its pre-kind-awareness behavior.
        const out = [];
        const seen = new Set();
        for (const e of entries) {
            if (!seen.has(e.parentId)) {
                seen.add(e.parentId);
                out.push(e.parentId);
            }
        }
        return out;
    };
    const getAncestors = (childNodeId) => {
        const result = [];
        const visited = new Set();
        visited.add(childNodeId); // prevent cycles through the start node
        // BFS with bounded depth
        let frontier = getParents(childNodeId);
        let depth = 0;
        while (frontier.length > 0 && depth < MAX_ANCESTOR_DEPTH) {
            const nextFrontier = [];
            for (const parentId of frontier) {
                if (visited.has(parentId))
                    continue;
                visited.add(parentId);
                result.push(parentId);
                // Expand parent's own parents for next level
                const grandparents = entriesFor(parentId);
                if (grandparents) {
                    const gpSeen = new Set();
                    for (const gp of grandparents) {
                        if (gpSeen.has(gp.parentId))
                            continue;
                        gpSeen.add(gp.parentId);
                        if (!visited.has(gp.parentId))
                            nextFrontier.push(gp.parentId);
                    }
                }
            }
            frontier = nextFrontier;
            depth++;
        }
        return result;
    };
    /**
     * Lazy-computed per-owner split of direct parents into instance-dispatch
     * (non-`extend`) and singleton-dispatch (`extend`-only) views. Memoized on
     * first request so the `.filter()` pass happens at most once per owner per
     * HeritageMap lifetime, not per call-site dispatch.
     *
     * Shared empty-array sentinels for owners with no entries in a given view
     * avoid per-call allocation when the split is asymmetric (common Ruby case:
     * a class has `include` but no `extend`, so its singleton view is empty).
     */
    const EMPTY_PARENT_ENTRIES = [];
    const splitCache = new Map();
    const splitForOwner = (childNodeId) => {
        let cached = splitCache.get(childNodeId);
        if (cached)
            return cached;
        const entries = entriesFor(childNodeId);
        if (!entries || entries.length === 0) {
            cached = { instance: EMPTY_PARENT_ENTRIES, singleton: EMPTY_PARENT_ENTRIES };
        }
        else {
            const instance = [];
            const singleton = [];
            for (const e of entries) {
                if (e.kind === 'extend')
                    singleton.push(e);
                else
                    instance.push(e);
            }
            cached = {
                instance: instance.length === 0 ? EMPTY_PARENT_ENTRIES : instance,
                singleton: singleton.length === 0 ? EMPTY_PARENT_ENTRIES : singleton,
            };
        }
        splitCache.set(childNodeId, cached);
        return cached;
    };
    /**
     * Instance-dispatch ancestry walk. Excludes `extend` (singleton-only).
     * For kind-aware consumers (Ruby MRO): walks parents in source-insertion
     * order. The consumer is responsible for interleaving self / reversing
     * prepend order / etc. This method preserves raw declaration order.
     *
     * Result is cached per owner; repeat calls return the same array.
     */
    const getInstanceAncestry = (childNodeId) => splitForOwner(childNodeId).instance;
    /**
     * Singleton-dispatch ancestry walk. Only `extend` parents. For non-Ruby
     * languages this is always empty (no language currently produces `extend`
     * heritage records outside Ruby).
     *
     * Result is cached per owner; repeat calls return the same array.
     */
    const getSingletonAncestry = (childNodeId) => splitForOwner(childNodeId).singleton;
    const getImplementorFiles = (interfaceName) => {
        return implementorFiles.get(interfaceName) ?? EMPTY_SET;
    };
    if (profileHeritage) {
        logDeferredProfile(`buildHeritageMap: ${heritage.length} heritage records, ` +
            `${ambiguousHeritageRecords} with child×parent lookup product >1, ` +
            `max product ${maxNameCartesian}, ` +
            `${unresolvedChildLookups} unresolved child lookups, ` +
            `${unresolvedParentLookups} unresolved parent lookups, ` +
            `${implementorFiles.size} interface implementor keys`);
    }
    return {
        getParents,
        getAncestors,
        getParentEntries,
        getInstanceAncestry,
        getSingletonAncestry,
        getImplementorFiles,
    };
};
