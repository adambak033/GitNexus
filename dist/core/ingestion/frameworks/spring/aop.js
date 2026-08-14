import { resolveCallerGraphId, resolveDefGraphId, } from '../../scope-resolution/graph-bridge/ids.js';
import { stripBidiAndZeroWidth } from '../../utils/ast-helpers.js';
import { parseSpringAnnotationArguments, parseStaticStringLiteral, } from './annotation-arguments.js';
import { createSpringAnnotationNameResolver } from './bean-candidates.js';
export const SPRING_AOP_REASON_PREFIX = 'spring-aop:v1:';
export const SPRING_AOP_EVIDENCE_DESCRIPTION_PREFIX = 'Spring AOP: ';
export const SPRING_AOP_EVIDENCE_ID_PREFIX = 'CodeElement:spring-aop:';
const MAX_POINTCUT_LENGTH = 1_000;
const metadataByGraph = new WeakMap();
function graphMetadata(graph) {
    let metadata = metadataByGraph.get(graph);
    if (metadata === undefined) {
        metadata = {
            candidateFilePaths: new Set(),
            aspectClassIds: new Set(),
            singletonInstanceClassIds: new Set(),
            aspects: [],
            behaviors: [],
            advices: [],
        };
        metadataByGraph.set(graph, metadata);
    }
    return metadata;
}
export function getSpringAopGraphMetadata(graph) {
    return graphMetadata(graph);
}
const ASPECT_ANNOTATION = 'org.aspectj.lang.annotation.Aspect';
const BEHAVIOR_ANNOTATIONS = new Map([
    ['org.springframework.transaction.annotation.Transactional', 'transactional'],
    ['jakarta.transaction.Transactional', 'transactional'],
    ['javax.transaction.Transactional', 'transactional'],
    ['org.springframework.cache.annotation.Cacheable', 'cacheable'],
    ['org.springframework.cache.annotation.CacheEvict', 'cache-evict'],
    ['org.springframework.cache.annotation.CachePut', 'cache-put'],
    ['org.springframework.cache.annotation.Caching', 'caching'],
    ['org.springframework.security.access.prepost.PreAuthorize', 'authorization'],
    ['org.springframework.security.access.prepost.PostAuthorize', 'authorization'],
    ['org.springframework.security.access.prepost.PreFilter', 'authorization'],
    ['org.springframework.security.access.prepost.PostFilter', 'authorization'],
    ['org.springframework.security.access.annotation.Secured', 'authorization'],
    ['jakarta.annotation.security.RolesAllowed', 'authorization'],
    ['javax.annotation.security.RolesAllowed', 'authorization'],
]);
const ADVICE_ANNOTATIONS = new Map([
    ['org.aspectj.lang.annotation.Around', 'around'],
    ['org.aspectj.lang.annotation.Before', 'before'],
    ['org.aspectj.lang.annotation.After', 'after'],
    ['org.aspectj.lang.annotation.AfterReturning', 'after-returning'],
    ['org.aspectj.lang.annotation.AfterThrowing', 'after-throwing'],
    ['org.aspectj.lang.annotation.Pointcut', 'pointcut'],
]);
const RECOGNIZED_AOP_ANNOTATIONS = new Set([
    ASPECT_ANNOTATION,
    ...BEHAVIOR_ANNOTATIONS.keys(),
    ...ADVICE_ANNOTATIONS.keys(),
]);
const CAPTURE_RELEVANT_SIMPLE_NAMES = new Set([...RECOGNIZED_AOP_ANNOTATIONS].map((name) => simpleName(name)));
function simpleName(name) {
    const separator = name.lastIndexOf('.');
    return separator === -1 ? name : name.slice(separator + 1);
}
export function hasSpringAopRelevantAnnotation(annotations) {
    return annotations.some((annotation) => CAPTURE_RELEVANT_SIMPLE_NAMES.has(simpleName(annotation.name)));
}
function ownerGraphNode(fact, indexes, nodeLookup, graph, exactOwnerByRange) {
    const ownerScope = indexes.scopeTree.getScope(fact.ownerScopeId);
    let ownerId;
    if (fact.ownerKind === 'class' && ownerScope !== undefined) {
        const classDef = ownerScope.ownedDefs.find((definition) => definition.type === 'Class' || definition.type === 'Interface');
        if (classDef !== undefined)
            ownerId = resolveDefGraphId(classDef.filePath, classDef, nodeLookup);
    }
    else if (ownerScope !== undefined) {
        ownerId = resolveCallerGraphId(fact.ownerScopeId, indexes, nodeLookup);
    }
    if (ownerId === undefined && fact.ownerFilePath !== undefined && fact.ownerRange !== undefined) {
        const kind = fact.ownerKind === 'class' ? 'class' : 'callable';
        const fallback = exactOwnerByRange.get(`${kind}\0${fact.ownerFilePath}\0${fact.ownerRange.startLine - 1}\0${fact.ownerRange.endLine - 1}`);
        if (fallback !== null && fallback !== undefined)
            ownerId = fallback.id;
    }
    if (ownerId === undefined)
        return undefined;
    const owner = graph.getNode(ownerId);
    return owner === undefined || owner.label === 'File' ? undefined : owner;
}
function staticPointcutExpression(annotationText) {
    const args = parseSpringAnnotationArguments(annotationText);
    if (args === null)
        return null;
    const pointcutArguments = args.filter((argument) => argument.name === undefined || argument.name === 'value' || argument.name === 'pointcut');
    if (pointcutArguments.length !== 1)
        return null;
    const allowedCompanionArguments = new Set(['returning', 'throwing', 'argNames']);
    if (args.some((argument) => argument !== pointcutArguments[0] &&
        (argument.name === undefined || !allowedCompanionArguments.has(argument.name)))) {
        return null;
    }
    const argument = pointcutArguments[0];
    if (argument === undefined)
        return null;
    const parsed = parseStaticStringLiteral(argument.value);
    return parsed === null ? null : sanitizePointcut(parsed);
}
function sanitizePointcut(value) {
    const normalized = stripBidiAndZeroWidth(value).replace(/\s+/g, ' ').trim();
    return normalized.length > 0 && normalized.length <= MAX_POINTCUT_LENGTH ? normalized : null;
}
/**
 * Resolve syntax facts after imports and package visibility are complete.
 * Language adapters own AST shape only; this shared layer owns framework FQNs.
 */
export function createSpringAopMetadataAttacher(adapter) {
    return (graph, parsedFiles, nodeLookup, indexes) => {
        const resolveAnnotation = createSpringAnnotationNameResolver(indexes);
        const metadata = graphMetadata(graph);
        const exactOwnerByRange = new Map();
        for (const node of graph.iterNodes()) {
            const kind = node.label === 'Method'
                ? 'callable'
                : node.label === 'Class' || node.label === 'Interface'
                    ? 'class'
                    : undefined;
            if (kind === undefined || typeof node.properties.filePath !== 'string')
                continue;
            const key = `${kind}\0${node.properties.filePath}\0${node.properties.startLine}\0${node.properties.endLine}`;
            exactOwnerByRange.set(key, exactOwnerByRange.has(key) ? null : node);
        }
        let classIdByMethod;
        const singletonOwnerId = (owner) => {
            if (owner.label === 'Class' || owner.label === 'Interface')
                return owner.id;
            if (owner.label !== 'Method')
                return undefined;
            if (classIdByMethod === undefined) {
                const owners = new Map();
                for (const relationship of graph.iterRelationshipsByType('HAS_METHOD')) {
                    owners.set(relationship.targetId, relationship.sourceId);
                }
                classIdByMethod = owners;
            }
            return classIdByMethod.get(owner.id);
        };
        for (const parsed of parsedFiles) {
            // The set is populated only by registered language adapters. The shared
            // matcher can therefore reject same-qualified-name symbols from other
            // languages without naming Java/Kotlin in framework-generic code.
            metadata.candidateFilePaths.add(parsed.filePath);
            const incomplete = adapter.isPackageVisibilityIncomplete(parsed.filePath);
            const resolvedAnnotations = new Map();
            for (const fact of adapter.getFacts(parsed.filePath)) {
                const owner = ownerGraphNode(fact, indexes, nodeLookup, graph, exactOwnerByRange);
                const ownerScope = indexes.scopeTree.getScope(fact.ownerScopeId);
                if (owner === undefined)
                    continue;
                if (fact.singletonInstance === true) {
                    const singletonId = singletonOwnerId(owner);
                    if (singletonId !== undefined)
                        metadata.singletonInstanceClassIds.add(singletonId);
                }
                for (const annotation of fact.annotations) {
                    // `@get:`, `@field:`, etc. target generated/property elements rather
                    // than the callable represented by this fact. Guessing would overstate
                    // proxy behavior, so Kotlin use-site targets fail closed.
                    if (annotation.useSiteTarget !== undefined)
                        continue;
                    const enclosingScope = ownerScope?.parent ?? null;
                    const cacheKey = `${enclosingScope ?? '<root>'}\0${annotation.name}`;
                    let resolved = resolvedAnnotations.get(cacheKey);
                    if (!resolvedAnnotations.has(cacheKey)) {
                        resolved = resolveAnnotation(annotation.name, parsed, enclosingScope, RECOGNIZED_AOP_ANNOTATIONS, incomplete);
                        resolvedAnnotations.set(cacheKey, resolved);
                    }
                    if (resolved === undefined)
                        continue;
                    if (resolved === ASPECT_ANNOTATION && fact.ownerKind === 'class') {
                        metadata.aspectClassIds.add(owner.id);
                        metadata.aspects.push({
                            ownerId: owner.id,
                            annotation: resolved,
                            line: annotation.line,
                        });
                        continue;
                    }
                    const behavior = BEHAVIOR_ANNOTATIONS.get(resolved);
                    if (behavior !== undefined) {
                        metadata.behaviors.push({
                            ownerId: owner.id,
                            ownerKind: fact.ownerKind,
                            annotation: resolved,
                            behavior,
                            line: annotation.line,
                        });
                        continue;
                    }
                    const advice = ADVICE_ANNOTATIONS.get(resolved);
                    if (advice !== undefined && fact.ownerKind === 'callable' && owner.label === 'Method') {
                        metadata.advices.push({
                            ownerId: owner.id,
                            annotation: resolved,
                            advice,
                            pointcut: staticPointcutExpression(annotation.text),
                            line: annotation.line,
                        });
                    }
                }
            }
        }
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isBoundedString(value, maxLength = MAX_POINTCUT_LENGTH) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}
const BEHAVIORS = new Set([
    'transactional',
    'caching',
    'cacheable',
    'cache-evict',
    'cache-put',
    'authorization',
]);
const ADVICES = new Set([
    'around',
    'before',
    'after',
    'after-returning',
    'after-throwing',
]);
export function encodeSpringAopReason(reason) {
    return `${SPRING_AOP_REASON_PREFIX}${JSON.stringify(reason)}`;
}
/** Decode only the current, validated reason contract; malformed/foreign rows fail closed. */
export function decodeSpringAopReason(value) {
    if (typeof value !== 'string' || !value.startsWith(SPRING_AOP_REASON_PREFIX))
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(value.slice(SPRING_AOP_REASON_PREFIX.length));
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || !isBoundedString(parsed.annotation))
        return undefined;
    if (parsed.kind === 'behavior' &&
        typeof parsed.behavior === 'string' &&
        BEHAVIORS.has(parsed.behavior) &&
        BEHAVIOR_ANNOTATIONS.get(parsed.annotation) === parsed.behavior &&
        (parsed.declaredOn === 'class' || parsed.declaredOn === 'method') &&
        parsed.activation === 'unknown' &&
        parsed.proxy === 'possible') {
        return parsed;
    }
    if (parsed.kind === 'advice' &&
        typeof parsed.advice === 'string' &&
        ADVICES.has(parsed.advice) &&
        ADVICE_ANNOTATIONS.get(parsed.annotation) === parsed.advice &&
        isBoundedString(parsed.pointcut) &&
        parsed.match === 'static' &&
        parsed.activation === 'unknown' &&
        parsed.proxy === 'possible') {
        return parsed;
    }
    if (parsed.kind === 'pointcut' &&
        ADVICE_ANNOTATIONS.has(parsed.annotation) &&
        (parsed.pointcut === null || isBoundedString(parsed.pointcut)) &&
        ((parsed.match === 'static' &&
            parsed.resolution === 'resolved' &&
            typeof parsed.pointcut === 'string') ||
            (parsed.match === 'unresolved' && parsed.resolution === 'unknown'))) {
        return parsed;
    }
    if (parsed.kind === 'aspect' &&
        parsed.annotation === ASPECT_ANNOTATION &&
        parsed.activation === 'unknown' &&
        parsed.registration === 'unknown') {
        return parsed;
    }
    return undefined;
}
export function isSpringAopEvidenceNode(node) {
    return node.label === 'CodeElement' && node.id.startsWith(SPRING_AOP_EVIDENCE_ID_PREFIX);
}
const TYPE_PATTERN = /^[A-Za-z_$*][A-Za-z0-9_$.*]*$/;
const METHOD_PATTERN = /^[A-Za-z_$*][A-Za-z0-9_$*]*$/;
/** Parse the deliberately narrow, fully static pointcut subset supported in v1. */
export function parseSpringAopPointcut(expression) {
    const normalized = sanitizePointcut(expression);
    if (normalized === null)
        return null;
    const annotation = /^@annotation\s*\(\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\)$/.exec(normalized);
    if (annotation !== null) {
        const annotationName = annotation[1];
        return annotationName !== undefined && BEHAVIOR_ANNOTATIONS.has(annotationName)
            ? { kind: 'annotation', annotation: annotationName }
            : null;
    }
    const within = /^within\s*\(\s*([^()]+?)\s*\)$/.exec(normalized);
    if (within !== null) {
        const ownerPattern = within[1]?.trim();
        return ownerPattern !== undefined && validTypePattern(ownerPattern)
            ? { kind: 'within', ownerPattern }
            : null;
    }
    const execution = /^execution\s*\(\s*([^()]*)\(([^()]*)\)\s*\)$/.exec(normalized);
    if (execution === null)
        return null;
    const head = execution[1]?.trim();
    const parameters = execution[2]?.trim();
    if (head === undefined || parameters === undefined)
        return null;
    const tokens = head.split(/\s+/);
    let visibility;
    let returnPattern;
    let qualifiedMethod;
    if (tokens.length === 2) {
        [returnPattern, qualifiedMethod] = tokens;
    }
    else if (tokens.length === 3 && tokens[0] === 'public') {
        const publicTokens = tokens;
        visibility = 'public';
        returnPattern = publicTokens[1];
        qualifiedMethod = publicTokens[2];
    }
    else {
        return null;
    }
    if (returnPattern !== '*')
        return null;
    const separator = qualifiedMethod.lastIndexOf('.');
    const ownerPattern = separator === -1 ? '*' : qualifiedMethod.slice(0, separator);
    const methodPattern = separator === -1 ? qualifiedMethod : qualifiedMethod.slice(separator + 1);
    if (!validTypePattern(ownerPattern) || !METHOD_PATTERN.test(methodPattern))
        return null;
    let parameterCount;
    if (parameters === '..')
        parameterCount = undefined;
    else if (parameters === '')
        parameterCount = 0;
    else {
        const parameterPatterns = parameters.split(',').map((part) => part.trim());
        if (parameterPatterns.some((part) => part !== '*'))
            return null;
        parameterCount = parameterPatterns.length;
    }
    return {
        kind: 'execution',
        ownerPattern,
        methodPattern,
        ...(visibility === undefined ? {} : { visibility }),
        ...(parameterCount === undefined ? {} : { parameterCount }),
    };
}
function validTypePattern(pattern) {
    return (TYPE_PATTERN.test(pattern) &&
        // A simple exact type name needs the aspect's package/import scope to
        // resolve correctly. That context is not retained in the v1 record, so
        // fail closed instead of claiming a static match. Unqualified wildcard
        // patterns are self-contained and match the declaring type's simple name.
        (pattern.includes('.') || pattern.includes('*')) &&
        !pattern.includes('...') &&
        pattern.split('..').length <= 2 &&
        !pattern.endsWith('.'));
}
function findLiteral(value, literal, startIndex, endExclusive) {
    const prefixLengths = new Array(literal.length).fill(0);
    for (let index = 1, prefixLength = 0; index < literal.length; index += 1) {
        while (prefixLength > 0 && literal[index] !== literal[prefixLength]) {
            prefixLength = prefixLengths[prefixLength - 1] ?? 0;
        }
        if (literal[index] === literal[prefixLength])
            prefixLength += 1;
        prefixLengths[index] = prefixLength;
    }
    for (let index = startIndex, prefixLength = 0; index < endExclusive; index += 1) {
        while (prefixLength > 0 && value[index] !== literal[prefixLength]) {
            prefixLength = prefixLengths[prefixLength - 1] ?? 0;
        }
        if (value[index] === literal[prefixLength])
            prefixLength += 1;
        if (prefixLength === literal.length)
            return index - literal.length + 1;
    }
    return -1;
}
/** Match a single-segment glob in O(pattern + value) without regex backtracking. */
function segmentGlobMatches(pattern, value) {
    if (!pattern.includes('*'))
        return pattern === value;
    const literalChunks = pattern.split('*').filter((chunk) => chunk.length > 0);
    if (literalChunks.length === 0)
        return true;
    let firstMiddleChunk = 0;
    let lastMiddleChunkExclusive = literalChunks.length;
    let cursor = 0;
    let middleEndExclusive = value.length;
    if (!pattern.startsWith('*')) {
        const prefix = literalChunks[0] ?? '';
        if (!value.startsWith(prefix))
            return false;
        cursor = prefix.length;
        firstMiddleChunk = 1;
    }
    if (!pattern.endsWith('*')) {
        const suffix = literalChunks[literalChunks.length - 1] ?? '';
        const suffixStart = value.length - suffix.length;
        if (suffixStart < cursor || !value.endsWith(suffix))
            return false;
        middleEndExclusive = suffixStart;
        lastMiddleChunkExclusive -= 1;
    }
    for (let index = firstMiddleChunk; index < lastMiddleChunkExclusive; index += 1) {
        const chunk = literalChunks[index] ?? '';
        const matchIndex = findLiteral(value, chunk, cursor, middleEndExclusive);
        if (matchIndex === -1)
            return false;
        cursor = matchIndex + chunk.length;
    }
    return cursor <= middleEndExclusive;
}
function patternSegmentsMatch(patternSegments, valueSegments) {
    return (patternSegments.length === valueSegments.length &&
        patternSegments.every((segment, index) => segmentGlobMatches(segment, valueSegments[index] ?? '')));
}
/** Match Spring's narrow type-pattern subset without compiling repository input as regex. */
function typePatternMatches(pattern, value) {
    if (!validTypePattern(pattern) || value.length === 0)
        return false;
    if (pattern === '*')
        return true;
    const valueSegments = value.split('.');
    if (valueSegments.some((segment) => segment.length === 0))
        return false;
    if (!pattern.includes('.')) {
        return segmentGlobMatches(pattern, valueSegments[valueSegments.length - 1] ?? '');
    }
    const pieces = pattern.split('..');
    if (pieces.length === 1)
        return patternSegmentsMatch(pattern.split('.'), valueSegments);
    const leftSegments = (pieces[0] ?? '').split('.');
    const rightSegments = (pieces[1] ?? '').split('.');
    if (valueSegments.length < leftSegments.length + rightSegments.length)
        return false;
    return (patternSegmentsMatch(leftSegments, valueSegments.slice(0, leftSegments.length)) &&
        patternSegmentsMatch(rightSegments, valueSegments.slice(-rightSegments.length)));
}
export function springAopPointcutMatches(pointcut, owner, method, methodAnnotations = new Set()) {
    if (method.label !== 'Method')
        return false;
    if (pointcut.kind === 'annotation')
        return methodAnnotations.has(pointcut.annotation);
    const qualifiedName = owner.properties.qualifiedName;
    if (typeof qualifiedName !== 'string')
        return false;
    if (!typePatternMatches(pointcut.ownerPattern, qualifiedName))
        return false;
    if (pointcut.kind === 'within')
        return true;
    if (pointcut.visibility === 'public' &&
        method.properties.visibility !== 'public' &&
        // Java and Kotlin interface methods are public when no visibility modifier
        // is present. Their extractors retain that absence as `package`; explicit
        // private members remain private and therefore fail this exception.
        !(owner.label === 'Interface' && method.properties.visibility === 'package')) {
        return false;
    }
    if (pointcut.parameterCount !== undefined &&
        method.properties.parameterCount !== pointcut.parameterCount) {
        return false;
    }
    return segmentGlobMatches(pointcut.methodPattern, method.properties.name);
}
