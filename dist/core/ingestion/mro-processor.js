/**
 * MRO (Method Resolution Order) Processor
 *
 * Walks the inheritance graph (EXTENDS/IMPLEMENTS edges), collects methods from
 * each ancestor via HAS_METHOD edges, detects method-name collisions across
 * parents, and applies language-specific resolution rules to emit METHOD_OVERRIDES edges.
 *
 * Language-specific rules:
 * - C++:       leftmost base class in declaration order wins
 * - C#/Java:   class method wins over interface default; multiple interface
 *              methods with same name are ambiguous (null resolution)
 * - Python:    C3 linearization determines MRO; first in linearized order wins
 * - Rust:      no auto-resolution — requires qualified syntax, resolvedTo = null
 * - Default:   single inheritance — first definition wins
 *
 * METHOD_OVERRIDES edge direction: Class → Method (not Method → Method).
 * The source is the child class that inherits conflicting methods,
 * the target is the winning ancestor method node.
 * Cypher: MATCH (c:Class)-[r:CodeRelation {type: 'METHOD_OVERRIDES'}]->(m:Method)
 */
import { generateId } from '../../lib/utils.js';
import { getProvider } from './languages/index.js';
import { c3Linearize, gatherAncestors } from './model/resolve.js';
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/** Collect EXTENDS, IMPLEMENTS, and HAS_METHOD adjacency from the graph. */
function buildAdjacency(graph) {
    // parentMap: childId → parentIds[] (in insertion / declaration order)
    const parentMap = new Map();
    // methodMap: classId → methodIds[]
    const methodMap = new Map();
    // Track which edge type each parent link came from
    const parentEdgeType = new Map();
    // Three typed iterations replace one full-relationship-map scan
    // with per-edge type checks. Each consumes only the edges of the
    // type it cares about — see plan
    // docs/plans/2026-04-20-002-perf-parse-heritage-mro-plan.md (Unit 2).
    for (const rel of graph.iterRelationshipsByType('EXTENDS')) {
        let parents = parentMap.get(rel.sourceId);
        if (!parents) {
            parents = [];
            parentMap.set(rel.sourceId, parents);
        }
        parents.push(rel.targetId);
        let edgeTypes = parentEdgeType.get(rel.sourceId);
        if (!edgeTypes) {
            edgeTypes = new Map();
            parentEdgeType.set(rel.sourceId, edgeTypes);
        }
        edgeTypes.set(rel.targetId, 'EXTENDS');
    }
    for (const rel of graph.iterRelationshipsByType('IMPLEMENTS')) {
        let parents = parentMap.get(rel.sourceId);
        if (!parents) {
            parents = [];
            parentMap.set(rel.sourceId, parents);
        }
        parents.push(rel.targetId);
        let edgeTypes = parentEdgeType.get(rel.sourceId);
        if (!edgeTypes) {
            edgeTypes = new Map();
            parentEdgeType.set(rel.sourceId, edgeTypes);
        }
        edgeTypes.set(rel.targetId, 'IMPLEMENTS');
    }
    for (const rel of graph.iterRelationshipsByType('HAS_METHOD')) {
        let methods = methodMap.get(rel.sourceId);
        if (!methods) {
            methods = [];
            methodMap.set(rel.sourceId, methods);
        }
        methods.push(rel.targetId);
    }
    return { parentMap, methodMap, parentEdgeType };
}
/** Confidence for a single-ancestor override edge (a subclass overriding one parent
 *  method via class inheritance) — same tier as MRO-ordered resolution. */
const SINGLE_ANCESTOR_OVERRIDE_CONFIDENCE = 0.9;
/** Resolve by MRO order — first ancestor in linearized order wins. */
function resolveByMroOrder(methodName, defs, mroOrder, reasonPrefix) {
    for (const ancestorId of mroOrder) {
        const match = defs.find((d) => d.classId === ancestorId);
        if (match) {
            return {
                resolvedTo: match.methodId,
                reason: `${reasonPrefix}: ${match.className}::${methodName}`,
                confidence: 0.9, // MRO-ordered resolution
            };
        }
    }
    return {
        resolvedTo: defs[0].methodId,
        reason: `${reasonPrefix} fallback: first definition`,
        confidence: 0.7,
    };
}
function resolveCsharpJava(methodName, defs, parentEdgeTypes) {
    const classDefs = [];
    const interfaceDefs = [];
    for (const def of defs) {
        const edgeType = parentEdgeTypes?.get(def.classId);
        if (edgeType === 'IMPLEMENTS') {
            interfaceDefs.push(def);
        }
        else {
            classDefs.push(def);
        }
    }
    if (classDefs.length > 0) {
        return {
            resolvedTo: classDefs[0].methodId,
            reason: `class method wins: ${classDefs[0].className}::${methodName}`,
            confidence: 0.95, // Class method is authoritative
        };
    }
    if (interfaceDefs.length > 1) {
        return {
            resolvedTo: null,
            reason: `ambiguous: ${methodName} defined in multiple interfaces: ${interfaceDefs.map((d) => d.className).join(', ')}`,
            confidence: 0.5,
        };
    }
    if (interfaceDefs.length === 1) {
        return {
            resolvedTo: interfaceDefs[0].methodId,
            reason: `single interface default: ${interfaceDefs[0].className}::${methodName}`,
            confidence: 0.85, // Single interface, unambiguous
        };
    }
    return { resolvedTo: null, reason: 'no resolution found', confidence: 0.5 };
}
// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export function computeMRO(graph) {
    const { parentMap, methodMap, parentEdgeType } = buildAdjacency(graph);
    const c3Cache = new Map();
    const entries = [];
    let overrideEdges = 0;
    let ambiguityCount = 0;
    // Pre-computed maps to avoid redundant BFS in emitMethodImplementsEdges
    const ancestorsMap = new Map();
    const edgeTypesMap = new Map();
    // Process every class that has at least one parent
    for (const [classId, directParents] of parentMap) {
        if (directParents.length === 0)
            continue;
        const classNode = graph.getNode(classId);
        if (!classNode)
            continue;
        const language = classNode.properties.language;
        if (!language)
            continue;
        const className = classNode.properties.name;
        // Compute linearized MRO depending on language strategy
        const provider = getProvider(language);
        const ancestors = gatherAncestors(classId, parentMap);
        ancestorsMap.set(classId, ancestors);
        edgeTypesMap.set(classId, buildTransitiveEdgeTypes(classId, parentMap, parentEdgeType));
        let mroOrder;
        if (provider.mroStrategy === 'c3') {
            const c3Result = c3Linearize(classId, parentMap, c3Cache);
            mroOrder = c3Result ?? ancestors;
        }
        else {
            mroOrder = ancestors;
        }
        // Get the parent names for the MRO entry
        const mroNames = mroOrder
            .map((id) => graph.getNode(id)?.properties.name)
            .filter((n) => n !== undefined);
        // Collect methods from all ancestors, grouped by method name
        const methodsByName = new Map();
        for (const ancestorId of mroOrder) {
            const ancestorNode = graph.getNode(ancestorId);
            if (!ancestorNode)
                continue;
            const methods = methodMap.get(ancestorId) ?? [];
            for (const methodId of methods) {
                const methodNode = graph.getNode(methodId);
                if (!methodNode)
                    continue;
                // Properties don't participate in method resolution order
                if (methodNode.label === 'Property')
                    continue;
                const methodName = methodNode.properties.name;
                let defs = methodsByName.get(methodName);
                if (!defs) {
                    defs = [];
                    methodsByName.set(methodName, defs);
                }
                // Avoid duplicates (same method seen via multiple paths)
                if (!defs.some((d) => d.methodId === methodId)) {
                    defs.push({
                        classId: ancestorId,
                        className: ancestorNode.properties.name,
                        methodId,
                    });
                }
            }
        }
        // Detect collisions: methods defined in 2+ different ancestors
        const ambiguities = [];
        // Use pre-computed transitive edge types (only needed for implements-split languages)
        const needsEdgeTypes = provider.mroStrategy === 'implements-split';
        const classEdgeTypes = needsEdgeTypes ? edgeTypesMap.get(classId) : undefined;
        for (const [methodName, defs] of methodsByName) {
            if (defs.length < 2)
                continue;
            // Own method shadows inherited — no ambiguity
            const ownMethods = methodMap.get(classId) ?? [];
            const ownDefinesIt = ownMethods.some((mid) => {
                const mn = graph.getNode(mid);
                return mn?.properties.name === methodName;
            });
            if (ownDefinesIt)
                continue;
            let resolution;
            switch (provider.mroStrategy) {
                case 'leftmost-base':
                    resolution = resolveByMroOrder(methodName, defs, mroOrder, 'leftmost base');
                    break;
                case 'implements-split':
                    resolution = resolveCsharpJava(methodName, defs, classEdgeTypes);
                    break;
                case 'c3':
                    resolution = resolveByMroOrder(methodName, defs, mroOrder, 'C3 MRO');
                    break;
                case 'qualified-syntax':
                    resolution = {
                        resolvedTo: null,
                        reason: `requires qualified syntax: <Type as Trait>::${methodName}()`,
                        confidence: 0.5,
                    };
                    break;
                default:
                    resolution = resolveByMroOrder(methodName, defs, mroOrder, 'first definition');
                    break;
            }
            const ambiguity = {
                methodName,
                definedIn: defs,
                resolvedTo: resolution.resolvedTo,
                reason: resolution.reason,
            };
            ambiguities.push(ambiguity);
            if (resolution.resolvedTo === null) {
                ambiguityCount++;
            }
            // Emit METHOD_OVERRIDES edge if resolution found
            if (resolution.resolvedTo !== null) {
                graph.addRelationship({
                    id: generateId('METHOD_OVERRIDES', `${classId}->${resolution.resolvedTo}`),
                    sourceId: classId,
                    targetId: resolution.resolvedTo,
                    type: 'METHOD_OVERRIDES',
                    confidence: resolution.confidence,
                    reason: resolution.reason,
                });
                overrideEdges++;
            }
        }
        entries.push({
            classId,
            className,
            language,
            mro: mroNames,
            ambiguities,
        });
    }
    // ── Single-ancestor override detection ──────────────────────────────────
    // The collision loop above only emits when a method is defined in 2+ ancestors
    // (defs.length < 2 is skipped). A subclass overriding a single parent method via
    // class inheritance is the common case. Applicability is derived automatically from
    // the language's existing MRO strategy — no separate per-language flag: every
    // strategy resolves overrides by inheritance order EXCEPT `qualified-syntax` (Rust),
    // where a same-named method is a trait implementation (METHOD_IMPLEMENTS), not an
    // override. The EXTENDS-only walk below reinforces this structurally.
    const emittedOverrideEdgeIds = new Set();
    // Follow only EXTENDS (class-inheritance) parents and skip Interface/Trait ancestors:
    // satisfying an interface/trait default method is a METHOD_IMPLEMENTS relationship
    // (handled by emitMethodImplementsEdges), not an override. This also structurally
    // excludes languages without class inheritance (e.g. Rust traits use IMPLEMENTS).
    const extendsParentsOf = (nodeId) => (parentMap.get(nodeId) ?? []).filter((pid) => {
        if (parentEdgeType.get(nodeId)?.get(pid) !== 'EXTENDS')
            return false;
        const pn = graph.getNode(pid);
        return !!pn && pn.label !== 'Interface' && pn.label !== 'Trait';
    });
    for (const classId of parentMap.keys()) {
        const classNode = graph.getNode(classId);
        const language = classNode?.properties.language;
        if (!language)
            continue;
        // Language-aware gate, reusing the MRO model we already maintain (not a new flag).
        if (getProvider(language).mroStrategy === 'qualified-syntax')
            continue;
        const ownMethods = methodMap.get(classId) ?? [];
        const extendsParents = extendsParentsOf(classId);
        if (extendsParents.length === 0 || ownMethods.length === 0)
            continue;
        const orderedAncestorMethods = [];
        {
            const visited = new Set();
            const queue = [...extendsParents];
            while (queue.length > 0) {
                const ancestorId = queue.shift();
                if (visited.has(ancestorId))
                    continue;
                visited.add(ancestorId);
                const ancestorName = graph.getNode(ancestorId)?.properties.name;
                const methodsByName = new Map();
                for (const mid of methodMap.get(ancestorId) ?? []) {
                    const mn = graph.getNode(mid);
                    if (!mn || mn.label === 'Property' || typeof mn.properties.name !== 'string')
                        continue;
                    const entry = {
                        methodId: mid,
                        paramTypes: mn.properties.parameterTypes ?? [],
                        paramCount: mn.properties.parameterCount,
                    };
                    const bucket = methodsByName.get(mn.properties.name);
                    if (bucket)
                        bucket.push(entry);
                    else
                        methodsByName.set(mn.properties.name, [entry]);
                }
                orderedAncestorMethods.push({
                    className: typeof ancestorName === 'string' ? ancestorName : '<anonymous>',
                    methodsByName,
                });
                queue.push(...extendsParentsOf(ancestorId));
            }
        }
        for (const methodId of ownMethods) {
            const methodNode = graph.getNode(methodId);
            if (!methodNode || methodNode.label === 'Property' || !methodNode.properties.name)
                continue;
            const methodName = methodNode.properties.name;
            const ownParamTypes = methodNode.properties.parameterTypes ?? [];
            const ownParamCount = methodNode.properties.parameterCount;
            // Nearest ancestor (BFS order) defining this method by name AND signature, so a
            // same-named overload (e.g. foo(int) vs foo()) is not mistaken for an override.
            for (const { className, methodsByName } of orderedAncestorMethods) {
                const sameName = methodsByName.get(methodName);
                if (!sameName)
                    continue;
                const matches = sameName.filter((m) => parameterTypesMatch(ownParamTypes, m.paramTypes, ownParamCount, m.paramCount).match);
                if (matches.length === 0)
                    continue; // name present but no signature match — look deeper
                // Emit only when the match is unambiguous (exactly one candidate); >1 means the
                // override target cannot be pinned, so emit nothing. Either way stop — a closer
                // ancestor shadows anything deeper.
                if (matches.length === 1) {
                    const matchingMethodId = matches[0].methodId;
                    // Target the ancestor METHOD node (not the class), key the id on the method
                    // so distinct overrides stay distinct, and count only edges actually added
                    // (addRelationship is first-writer-wins, so a duplicate id is dropped).
                    const overrideId = generateId('METHOD_OVERRIDES', `${classId}->${matchingMethodId}`);
                    if (!emittedOverrideEdgeIds.has(overrideId)) {
                        emittedOverrideEdgeIds.add(overrideId);
                        graph.addRelationship({
                            id: overrideId,
                            sourceId: classId,
                            targetId: matchingMethodId,
                            type: 'METHOD_OVERRIDES',
                            confidence: SINGLE_ANCESTOR_OVERRIDE_CONFIDENCE,
                            reason: `single-ancestor override: ${className}::${methodName}()`,
                        });
                        overrideEdges++;
                    }
                }
                break; // nearest ancestor shadows deeper ones
            }
        }
    }
    const methodImplementsEdges = emitMethodImplementsEdges(graph, parentMap, methodMap, parentEdgeType, ancestorsMap, edgeTypesMap);
    return { entries, overrideEdges, ambiguityCount, methodImplementsEdges };
}
// ---------------------------------------------------------------------------
// METHOD_IMPLEMENTS edge emission
// ---------------------------------------------------------------------------
/**
 * Check if two parameter type arrays match.
 * When either side has no type info, fall back to parameterCount comparison
 * (arity-compatible matching). If both have parameterCount and they differ,
 * return no match. If counts match, return confident match. If either count
 * is undefined, return lenient (non-confident) match.
 *
 * Returns `{ match, confident }`:
 * - Exact type match → `{ match: true, confident: true }`
 * - Arity match (both have parameterCount, counts equal) → `{ match: true, confident: true }`
 * - Lenient (either side lacks types AND lacks parameterCount) → `{ match: true, confident: false }`
 * - No match → `{ match: false, confident: false }`
 */
function parameterTypesMatch(a, b, aParamCount, bParamCount) {
    // If one side is variadic and the other isn't, types may match superficially
    // but the methods aren't guaranteed to be interchangeable
    if ((aParamCount === undefined) !== (bParamCount === undefined)) {
        return { match: true, confident: false };
    }
    if (a.length === 0 || b.length === 0) {
        // Fall back to arity check when type info is missing
        if (aParamCount !== undefined && bParamCount !== undefined) {
            return { match: aParamCount === bParamCount, confident: aParamCount === bParamCount };
        }
        return { match: true, confident: false }; // lenient when either count is unknown
    }
    if (a.length !== b.length)
        return { match: false, confident: false };
    const exact = a.every((t, i) => t === b[i]);
    return { match: exact, confident: exact };
}
/**
 * For each concrete class that implements/extends an interface or trait,
 * find methods in the class that implement methods defined in the interface
 * and emit METHOD_IMPLEMENTS edges: ConcreteMethod → InterfaceMethod.
 *
 * Method node IDs include a `#<paramCount>` arity suffix, so overloaded
 * methods with different parameter counts are distinct nodes in the graph.
 * For same-arity overloads with different parameter types, a `~type1,type2`
 * suffix is appended when type info is available (issue #651), producing
 * distinct nodes that `parameterTypesMatch` can resolve to correct edges.
 */
function emitMethodImplementsEdges(graph, parentMap, methodMap, parentEdgeType, ancestorsMap, edgeTypesMap) {
    let edgeCount = 0;
    for (const [classId, parentIds] of parentMap) {
        const classNode = graph.getNode(classId);
        if (!classNode)
            continue;
        // Interfaces and traits declare contracts — they don't implement them
        if (classNode.label === 'Interface' || classNode.label === 'Trait')
            continue;
        // Get this class's own methods
        const ownMethodIds = methodMap.get(classId) ?? [];
        // Build a lookup: methodName → Array<{methodId, parameterTypes, parameterCount}> for own methods
        const ownMethodsByName = new Map();
        for (const methodId of ownMethodIds) {
            const methodNode = graph.getNode(methodId);
            if (!methodNode || methodNode.label === 'Property')
                continue;
            // Abstract methods don't satisfy interface contracts
            if (methodNode.properties.isAbstract === true)
                continue;
            const name = methodNode.properties.name;
            const parameterTypes = methodNode.properties.parameterTypes ?? [];
            const parameterCount = methodNode.properties.parameterCount;
            let bucket = ownMethodsByName.get(name);
            if (!bucket) {
                bucket = [];
                ownMethodsByName.set(name, bucket);
            }
            bucket.push({ methodId, parameterTypes, parameterCount });
        }
        // Use pre-computed ancestors and edge types; fall back to computing if missing (safety)
        const allAncestors = ancestorsMap.get(classId) ?? gatherAncestors(classId, parentMap);
        const ancestorEdgeTypes = edgeTypesMap.get(classId) ?? buildTransitiveEdgeTypes(classId, parentMap, parentEdgeType);
        // Dedup set: avoid duplicate edges from diamond paths
        const emitted = new Set();
        // For each ancestor, check if it's an interface/trait or classified as IMPLEMENTS
        for (const ancestorId of allAncestors) {
            const ancestorNode = graph.getNode(ancestorId);
            if (!ancestorNode)
                continue;
            const isInterfaceLike = ancestorNode.label === 'Interface' || ancestorNode.label === 'Trait';
            const classifiedEdgeType = ancestorEdgeTypes.get(ancestorId);
            if (!isInterfaceLike && classifiedEdgeType !== 'IMPLEMENTS')
                continue;
            // Get ancestor's methods
            const ancestorMethodIds = methodMap.get(ancestorId) ?? [];
            for (const ancestorMethodId of ancestorMethodIds) {
                const ancestorMethodNode = graph.getNode(ancestorMethodId);
                if (!ancestorMethodNode || ancestorMethodNode.label === 'Property')
                    continue;
                const ancestorName = ancestorMethodNode.properties.name;
                const ancestorParamTypes = ancestorMethodNode.properties.parameterTypes ?? [];
                const ancestorParamCount = ancestorMethodNode.properties.parameterCount;
                // Find matching method in own class by name + parameterTypes/arity
                const candidates = ownMethodsByName.get(ancestorName);
                // Unit 3: If no own method matches, walk the EXTENDS chain to find inherited concrete method
                if (!candidates || candidates.length === 0) {
                    const inherited = findInheritedMethod(classId, ancestorName, ancestorParamTypes, ancestorParamCount, graph, parentMap, methodMap, parentEdgeType, ancestorMethodId);
                    if (inherited) {
                        const edgeKey = `${inherited.methodId}->${ancestorMethodId}`;
                        if (!emitted.has(edgeKey)) {
                            emitted.add(edgeKey);
                            graph.addRelationship({
                                id: generateId('METHOD_IMPLEMENTS', edgeKey),
                                sourceId: inherited.methodId,
                                targetId: ancestorMethodId,
                                type: 'METHOD_IMPLEMENTS',
                                confidence: inherited.confident ? 1.0 : 0.7,
                                reason: '',
                            });
                            edgeCount++;
                        }
                    }
                    continue;
                }
                // Unit 4: Filter candidates by type/arity match, then check for ambiguity
                const matching = [];
                for (const c of candidates) {
                    const result = parameterTypesMatch(c.parameterTypes, ancestorParamTypes, c.parameterCount, ancestorParamCount);
                    if (result.match) {
                        matching.push({ ...c, confident: result.confident });
                    }
                }
                if (matching.length === 0)
                    continue;
                // If multiple candidates match at name+arity level, emit no edge (ambiguous)
                if (matching.length > 1)
                    continue;
                const winner = matching[0];
                const edgeKey = `${winner.methodId}->${ancestorMethodId}`;
                if (emitted.has(edgeKey))
                    continue;
                emitted.add(edgeKey);
                graph.addRelationship({
                    id: generateId('METHOD_IMPLEMENTS', edgeKey),
                    sourceId: winner.methodId,
                    targetId: ancestorMethodId,
                    type: 'METHOD_IMPLEMENTS',
                    confidence: winner.confident ? 1.0 : 0.7,
                    reason: '',
                });
                edgeCount++;
            }
        }
    }
    return edgeCount;
}
/**
 * Walk the class's EXTENDS chain to find the nearest concrete method matching
 * the given name and parameter signature. If the EXTENDS chain yields no match,
 * fall back to IMPLEMENTS parents and check for non-abstract default methods
 * (e.g. Java default interface methods, Kotlin interface defaults).
 * Returns the first matching method found in BFS order, or null.
 */
function findInheritedMethod(classId, methodName, targetParamTypes, targetParamCount, graph, parentMap, methodMap, parentEdgeType, 
/** Method ID to exclude from results (prevents self-edges when the ancestor
 *  method being matched lives on an IMPLEMENTS parent). */
excludeMethodId) {
    const visited = new Set();
    const queue = [];
    // Seed with direct EXTENDS parents only
    const directParents = parentMap.get(classId) ?? [];
    const directEdges = parentEdgeType.get(classId);
    for (const pid of directParents) {
        const et = directEdges?.get(pid);
        if (et === 'EXTENDS') {
            // Also check that the parent is not an Interface/Trait
            const parentNode = graph.getNode(pid);
            if (parentNode && parentNode.label !== 'Interface' && parentNode.label !== 'Trait') {
                queue.push(pid);
            }
        }
    }
    // Level-order BFS: process all ancestors at the current depth before
    // advancing. Once any match is found at depth D, finish that depth and stop.
    // Diamond dedup: same methodId via two paths at the same depth = 1 match.
    let currentLevel = [...queue];
    while (currentLevel.length > 0) {
        const matches = new Map();
        const nextLevel = [];
        for (const ancestorId of currentLevel) {
            if (visited.has(ancestorId))
                continue;
            visited.add(ancestorId);
            // Check this ancestor's methods
            const methods = methodMap.get(ancestorId) ?? [];
            for (const mid of methods) {
                const mNode = graph.getNode(mid);
                if (!mNode || mNode.label === 'Property')
                    continue;
                // Abstract inherited methods don't count as concrete implementations
                if (mNode.properties.isAbstract === true)
                    continue;
                if (mNode.properties.name !== methodName)
                    continue;
                const mParamTypes = mNode.properties.parameterTypes ?? [];
                const mParamCount = mNode.properties.parameterCount;
                const ptResult = parameterTypesMatch(mParamTypes, targetParamTypes, mParamCount, targetParamCount);
                if (ptResult.match) {
                    matches.set(mid, {
                        methodId: mid,
                        parameterTypes: mParamTypes,
                        confident: ptResult.confident,
                    });
                }
            }
            // Collect EXTENDS parents for the next depth level
            const grandparents = parentMap.get(ancestorId) ?? [];
            const ancestorEdges = parentEdgeType.get(ancestorId);
            for (const gp of grandparents) {
                if (visited.has(gp))
                    continue;
                const gpEdge = ancestorEdges?.get(gp);
                if (gpEdge === 'EXTENDS') {
                    const gpNode = graph.getNode(gp);
                    if (gpNode && gpNode.label !== 'Interface' && gpNode.label !== 'Trait') {
                        nextLevel.push(gp);
                    }
                }
            }
        }
        // If any matches found at this depth, decide and stop
        if (matches.size === 1)
            return matches.values().next().value;
        if (matches.size > 1)
            return null; // ambiguous at same depth
        currentLevel = nextLevel;
    }
    // ── Second pass: walk IMPLEMENTS parents AND their interface ancestry ──
    // Only reached when the EXTENDS chain yielded no match.
    // BFS through interface/trait hierarchy to find default (non-abstract) methods.
    const implBfsQueue = [];
    for (const pid of directParents) {
        const et = directEdges?.get(pid);
        if (et === 'IMPLEMENTS') {
            implBfsQueue.push(pid);
        }
    }
    // Collect all matches from the IMPLEMENTS BFS — return null if ambiguous (>1 match)
    const implMatches = [];
    const implVisited = new Set();
    while (implBfsQueue.length > 0) {
        const ifaceId = implBfsQueue.shift();
        if (implVisited.has(ifaceId))
            continue;
        implVisited.add(ifaceId);
        // Only process Interface/Trait nodes — Dart `implements Class` does not
        // inherit method bodies, so Class/Struct/Enum parents must be skipped.
        const ifaceNode = graph.getNode(ifaceId);
        if (!ifaceNode || (ifaceNode.label !== 'Interface' && ifaceNode.label !== 'Trait'))
            continue;
        // Check this interface/trait's methods for a non-abstract default
        const methods = methodMap.get(ifaceId) ?? [];
        for (const mid of methods) {
            if (mid === excludeMethodId)
                continue; // prevent self-edges
            const mNode = graph.getNode(mid);
            if (!mNode || mNode.label === 'Property')
                continue;
            if (mNode.properties.isAbstract === true)
                continue;
            if (mNode.properties.name !== methodName)
                continue;
            const mParamTypes = mNode.properties.parameterTypes ?? [];
            const mParamCount = mNode.properties.parameterCount;
            const ptResult = parameterTypesMatch(mParamTypes, targetParamTypes, mParamCount, targetParamCount);
            if (ptResult.match) {
                implMatches.push({
                    methodId: mid,
                    parameterTypes: mParamTypes,
                    confident: ptResult.confident,
                });
            }
        }
        // Walk this interface's parents (interface-extends-interface chains)
        const ifaceParents = parentMap.get(ifaceId) ?? [];
        for (const gp of ifaceParents) {
            if (!implVisited.has(gp))
                implBfsQueue.push(gp);
        }
    }
    // Ambiguous: multiple interfaces provide the same default method
    if (implMatches.length === 1)
        return implMatches[0];
    return null; // 0 matches or ambiguous (>1)
}
/**
 * Build transitive edge types for a class using BFS from the class to all ancestors.
 *
 * Known limitation: BFS first-reach heuristic can misclassify an interface as
 * EXTENDS if it's reachable via a class chain before being seen via IMPLEMENTS.
 * E.g. if BaseClass also implements IFoo, IFoo may be classified as EXTENDS.
 * This affects C#/Java/Kotlin conflict resolution in rare diamond hierarchies.
 */
function buildTransitiveEdgeTypes(classId, parentMap, parentEdgeType) {
    const result = new Map();
    const directEdges = parentEdgeType.get(classId);
    if (!directEdges)
        return result;
    // BFS: propagate edge type from direct parents
    const queue = [];
    const directParents = parentMap.get(classId) ?? [];
    for (const pid of directParents) {
        const et = directEdges.get(pid) ?? 'EXTENDS';
        if (!result.has(pid)) {
            result.set(pid, et);
            queue.push({ id: pid, edgeType: et });
        }
    }
    while (queue.length > 0) {
        const { id, edgeType } = queue.shift();
        const grandparents = parentMap.get(id) ?? [];
        for (const gp of grandparents) {
            if (!result.has(gp)) {
                result.set(gp, edgeType);
                queue.push({ id: gp, edgeType });
            }
        }
    }
    return result;
}
