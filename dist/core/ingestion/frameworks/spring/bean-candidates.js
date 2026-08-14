import { makeScopeId } from '../../../../_shared/index.js';
import { resolveDefGraphId } from '../../scope-resolution/graph-bridge/ids.js';
import { isClassLike, lookupBindingsAt } from '../../scope-resolution/scope/walkers.js';
import { SPRING_BEAN_STEREOTYPES } from './bean-catalog.js';
/** Per-language store for capture facts that cross the worker boundary. */
export function createClassAnnotationFactStore() {
    const factsByFile = new Map();
    return {
        clear: () => factsByFile.clear(),
        set: (filePath, facts) => {
            if (facts.length === 0)
                factsByFile.delete(filePath);
            else
                factsByFile.set(filePath, facts);
        },
        get: (filePath) => factsByFile.get(filePath) ?? [],
    };
}
/** Record one annotation from the language's existing scope-query traversal. */
export function recordClassAnnotationCapture(facts, filePath, classCapture, annotationName) {
    const classScopeId = makeScopeId({ filePath, range: classCapture.range, kind: 'Class' });
    const names = facts.get(classScopeId) ?? new Set();
    names.add(annotationName.trim());
    facts.set(classScopeId, names);
}
export function materializeClassAnnotationFacts(facts) {
    return [...facts].map(([classScopeId, annotationNames]) => ({
        classScopeId,
        annotationNames: [...annotationNames],
    }));
}
function simpleNameOf(def) {
    const qualifiedName = def.qualifiedName;
    if (qualifiedName === undefined)
        return undefined;
    const separator = qualifiedName.lastIndexOf('.');
    return separator === -1 ? qualifiedName : qualifiedName.slice(separator + 1);
}
function buildOwnedTypeNamesByOwner(indexes) {
    const namesByOwner = new Map();
    for (const def of indexes.defs.byId.values()) {
        if (def.ownerId === undefined)
            continue;
        if (!isClassLike(def.type) && def.type !== 'Annotation')
            continue;
        const simpleName = simpleNameOf(def);
        if (simpleName === undefined)
            continue;
        const names = namesByOwner.get(def.ownerId) ?? new Set();
        names.add(simpleName);
        namesByOwner.set(def.ownerId, names);
    }
    return namesByOwner;
}
function hasLexicalTypeDeclaration(startScope, simpleName, indexes) {
    let scopeId = startScope;
    const visited = new Set();
    while (scopeId !== null && !visited.has(scopeId)) {
        visited.add(scopeId);
        const scope = indexes.scopeTree.getScope(scopeId);
        if (scope === undefined)
            return false;
        const locals = scope.bindings.get(simpleName);
        if (locals?.some(({ def }) => isClassLike(def.type) || def.type === 'Annotation'))
            return true;
        scopeId = scope.parent;
    }
    return false;
}
function explicitImportTargets(parsed, simpleName) {
    const targets = new Set();
    for (const entry of parsed.parsedImports) {
        if (entry.kind !== 'named' && entry.kind !== 'alias')
            continue;
        if (entry.localName !== simpleName)
            continue;
        targets.add(entry.targetRaw);
    }
    return targets;
}
function hasInheritedTypeDeclaration(startScope, simpleName, indexes, ownedTypeNamesByOwner) {
    let scopeId = startScope;
    const visited = new Set();
    while (scopeId !== null && !visited.has(scopeId)) {
        visited.add(scopeId);
        const scope = indexes.scopeTree.getScope(scopeId);
        if (scope === undefined)
            return false;
        if (scope.kind === 'Class') {
            const classDef = scope.ownedDefs.find((def) => isClassLike(def.type));
            if (classDef !== undefined) {
                for (const ancestorId of indexes.methodDispatch.mroFor(classDef.nodeId)) {
                    if (ownedTypeNamesByOwner.get(ancestorId)?.has(simpleName) === true)
                        return true;
                }
            }
        }
        scopeId = scope.parent;
    }
    return false;
}
function hasVisibleTypeBinding(startScope, simpleName, indexes) {
    let scopeId = startScope;
    const visited = new Set();
    while (scopeId !== null && !visited.has(scopeId)) {
        visited.add(scopeId);
        const scope = indexes.scopeTree.getScope(scopeId);
        if (scope === undefined)
            return false;
        const visible = lookupBindingsAt(scopeId, simpleName, indexes);
        if (visible.some(({ def }) => isClassLike(def.type) || def.type === 'Annotation'))
            return true;
        scopeId = scope.parent;
    }
    return false;
}
function wildcardImportTarget(parsed, simpleName, recognizedAnnotations) {
    const wildcardPackages = new Set(parsed.parsedImports
        .filter((entry) => entry.kind === 'wildcard')
        .map((entry) => entry.targetRaw.replace(/\.\*$/, '')));
    if (wildcardPackages.size !== 1)
        return undefined;
    const [packageName] = wildcardPackages;
    const target = `${packageName}.${simpleName}`;
    return recognizedAnnotations.has(target) ? target : undefined;
}
/** Build a scope-aware Spring annotation resolver shared by framework hooks. */
export function createSpringAnnotationNameResolver(indexes) {
    const ownedTypeNamesByOwner = buildOwnedTypeNamesByOwner(indexes);
    return (rawName, parsed, enclosingScope, recognizedAnnotations, isPackageVisibilityIncomplete) => {
        if (rawName.includes('.')) {
            return recognizedAnnotations.has(rawName) ? rawName : undefined;
        }
        if (hasLexicalTypeDeclaration(enclosingScope, rawName, indexes))
            return undefined;
        if (hasInheritedTypeDeclaration(enclosingScope, rawName, indexes, ownedTypeNamesByOwner)) {
            return undefined;
        }
        const explicitImports = explicitImportTargets(parsed, rawName);
        if (explicitImports.size > 0) {
            if (explicitImports.size !== 1)
                return undefined;
            const [imported] = explicitImports;
            return recognizedAnnotations.has(imported) ? imported : undefined;
        }
        const wildcardTarget = wildcardImportTarget(parsed, rawName, recognizedAnnotations);
        if (wildcardTarget === undefined || isPackageVisibilityIncomplete)
            return undefined;
        return hasVisibleTypeBinding(enclosingScope, rawName, indexes) ? undefined : wildcardTarget;
    };
}
/** Build a language hook that enriches Class nodes after scope resolution. */
export function createSpringBeanCandidateAttacher(adapter) {
    return (graph, parsedFiles, nodeLookup, indexes) => {
        const resolveSpringAnnotation = createSpringAnnotationNameResolver(indexes);
        for (const parsed of parsedFiles) {
            for (const fact of adapter.getClassAnnotationFacts(parsed.filePath)) {
                const classScope = indexes.scopeTree.getScope(fact.classScopeId);
                if (classScope === undefined || classScope.kind !== 'Class')
                    continue;
                const classDef = classScope.ownedDefs.find((def) => def.type === 'Class');
                if (classDef === undefined)
                    continue;
                const graphId = resolveDefGraphId(parsed.filePath, classDef, nodeLookup);
                if (graphId === undefined)
                    continue;
                const classNode = graph.getNode(graphId);
                if (classNode === undefined || classNode.label !== 'Class')
                    continue;
                const recognized = new Set();
                for (const rawName of fact.annotationNames) {
                    const annotation = resolveSpringAnnotation(rawName, parsed, classScope.parent, SPRING_BEAN_STEREOTYPES, adapter.isPackageVisibilityIncomplete(parsed.filePath));
                    if (annotation !== undefined)
                        recognized.add(annotation);
                }
                if (recognized.size === 1) {
                    classNode.properties.frameworkAnnotations = [...recognized];
                }
            }
        }
    };
}
