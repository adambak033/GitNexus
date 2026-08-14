import { generateId } from '../../../../lib/utils.js';
import { resolveCallerGraphId, resolveDefGraphId, } from '../../scope-resolution/graph-bridge/ids.js';
import { stripBidiAndZeroWidth } from '../../utils/ast-helpers.js';
import { createSpringAnnotationNameResolver } from './bean-candidates.js';
import { SPRING_CONFIG_DESCRIPTION } from './config-bindings.js';
const PROFILE_ANNOTATION = 'org.springframework.context.annotation.Profile';
const CONDITIONAL_ANNOTATION = 'org.springframework.context.annotation.Conditional';
const AUTO_CONFIGURATION_ANNOTATION = 'org.springframework.boot.autoconfigure.AutoConfiguration';
const BOOT_CONDITIONAL_ANNOTATIONS = [
    'ConditionalOnBean',
    'ConditionalOnBooleanProperty',
    'ConditionalOnClass',
    'ConditionalOnCloudPlatform',
    'ConditionalOnExpression',
    'ConditionalOnJava',
    'ConditionalOnJndi',
    'ConditionalOnMissingBean',
    'ConditionalOnMissingClass',
    'ConditionalOnNotWebApplication',
    'ConditionalOnProperty',
    'ConditionalOnResource',
    'ConditionalOnSingleCandidate',
    'ConditionalOnThreading',
    'ConditionalOnWarDeployment',
    'ConditionalOnWebApplication',
];
const CONDITIONAL_ANNOTATIONS = new Set([
    PROFILE_ANNOTATION,
    CONDITIONAL_ANNOTATION,
    ...BOOT_CONDITIONAL_ANNOTATIONS.map((name) => `org.springframework.boot.autoconfigure.condition.${name}`),
]);
const PROPERTY_CONDITIONAL_ANNOTATIONS = new Set([
    'org.springframework.boot.autoconfigure.condition.ConditionalOnProperty',
    'org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty',
]);
const RESOLVABLE_SPRING_CONDITIONAL_ANNOTATIONS = new Set([
    ...CONDITIONAL_ANNOTATIONS,
    AUTO_CONFIGURATION_ANNOTATION,
]);
const CAPTURE_RELEVANT_SIMPLE_NAMES = new Set([
    'Profile',
    'Conditional',
    'AutoConfiguration',
    ...BOOT_CONDITIONAL_ANNOTATIONS,
]);
function simpleName(name) {
    const separator = name.lastIndexOf('.');
    return separator === -1 ? name : name.slice(separator + 1);
}
export function hasSpringConditionalRelevantAnnotation(annotations) {
    return annotations.some((annotation) => CAPTURE_RELEVANT_SIMPLE_NAMES.has(simpleName(annotation.name)));
}
function annotationArguments(text) {
    const start = text.indexOf('(');
    const end = text.lastIndexOf(')');
    if (start === -1 || end <= start)
        return undefined;
    const args = text.slice(start + 1, end).trim();
    return args.length === 0 ? undefined : args;
}
function splitTopLevelArguments(value) {
    const parts = [];
    let start = 0;
    let quote = null;
    let escaped = false;
    let round = 0;
    let square = 0;
    let curly = 0;
    for (let index = 0; index < value.length; index++) {
        const char = value.charAt(index);
        if (quote !== null) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === quote)
                quote = null;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '(')
            round++;
        else if (char === ')')
            round = Math.max(0, round - 1);
        else if (char === '[')
            square++;
        else if (char === ']')
            square = Math.max(0, square - 1);
        else if (char === '{')
            curly++;
        else if (char === '}')
            curly = Math.max(0, curly - 1);
        else if (char === ',' && round === 0 && square === 0 && curly === 0) {
            parts.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(value.slice(start).trim());
    return parts.filter((part) => part.length > 0);
}
function parseArguments(text) {
    const positional = [];
    const named = new Map();
    const args = annotationArguments(text);
    if (args === undefined)
        return { positional, named };
    for (const part of splitTopLevelArguments(args)) {
        const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(part);
        if (assignment === null)
            positional.push(part);
        else {
            const [, name, value] = assignment;
            if (name !== undefined && value !== undefined)
                named.set(name, value.trim());
        }
    }
    return { positional, named };
}
function decodeStaticString(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
function staticStrings(value) {
    if (value === undefined)
        return [];
    const values = [];
    for (let index = 0; index < value.length;) {
        if (value.startsWith('"""', index)) {
            const end = value.indexOf('"""', index + 3);
            if (end === -1)
                break;
            const decoded = value.slice(index + 3, end);
            if (!decoded.includes('${'))
                values.push(decoded);
            index = end + 3;
            continue;
        }
        if (value.charAt(index) !== '"') {
            index++;
            continue;
        }
        let end = index + 1;
        let escaped = false;
        for (; end < value.length; end++) {
            const char = value.charAt(end);
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                break;
        }
        if (end >= value.length)
            break;
        const decoded = decodeStaticString(value.slice(index, end + 1));
        if (decoded !== undefined)
            values.push(decoded);
        index = end + 1;
    }
    return values;
}
function propertyConditionKeys(annotationText) {
    const args = parseArguments(annotationText);
    const prefix = staticStrings(args.named.get('prefix'))[0]?.trim().replace(/\.+$/, '') ?? '';
    const names = staticStrings(args.named.get('name') ??
        args.named.get('value') ??
        (args.positional.length > 0 ? args.positional.join(',') : undefined));
    return [
        ...new Set(names
            .map((name) => name.replace(/^\.+/, '').trim())
            .filter((name) => name.length > 0)
            .map((name) => (prefix.length > 0 ? `${prefix}.${name}` : name))),
    ];
}
function conditionDescription(resolvedName, annotationText) {
    const args = annotationArguments(annotationText);
    const renderedArgs = args === undefined ? '' : `(${args.replace(/\s+/g, ' ').trim().slice(0, 1000)})`;
    return stripBidiAndZeroWidth(`Spring condition @${simpleName(resolvedName)}${renderedArgs}; activation unknown`);
}
function ownerGraphNode(fact, indexes, nodeLookup, graph) {
    const ownerScope = indexes.scopeTree.getScope(fact.ownerScopeId);
    if (ownerScope === undefined)
        return undefined;
    let ownerId;
    if (fact.ownerKind === 'class') {
        const classDef = ownerScope.ownedDefs.find((definition) => definition.type === 'Class' || definition.type === 'Record');
        if (classDef !== undefined) {
            ownerId = resolveDefGraphId(classDef.filePath, classDef, nodeLookup);
        }
    }
    else {
        ownerId = resolveCallerGraphId(fact.ownerScopeId, indexes, nodeLookup, {
            startLine: fact.annotations[0]?.line ?? ownerScope.range.startLine,
            startCol: 0,
        });
    }
    if (ownerId === undefined)
        return undefined;
    const owner = graph.getNode(ownerId);
    if (owner === undefined || owner.label === 'File')
        return undefined;
    return owner;
}
function addConditionNode(graph, owner, annotation, resolvedName) {
    const description = conditionDescription(resolvedName, annotation.text);
    const nodeId = generateId('Annotation', `spring-condition:${owner.id}:${annotation.line}:${resolvedName}:${description}`);
    const conditionNode = {
        id: nodeId,
        label: 'Annotation',
        properties: {
            name: `@${simpleName(resolvedName)}`,
            filePath: owner.properties.filePath,
            startLine: annotation.line,
            endLine: annotation.line,
            description,
        },
    };
    graph.addNode(conditionNode);
    const fileId = generateId('File', owner.properties.filePath);
    if (graph.getNode(fileId) !== undefined) {
        graph.addRelationship({
            id: generateId('DEFINES', `${fileId}->${nodeId}`),
            sourceId: fileId,
            targetId: nodeId,
            type: 'DEFINES',
            confidence: 1,
            reason: 'spring-condition:annotation',
        });
    }
    return conditionNode;
}
function addConditionalRelationship(graph, owner, target, annotation, resolvedName, detail) {
    const reason = stripBidiAndZeroWidth([`spring-condition:@${simpleName(resolvedName)}`, detail, 'activation=unknown']
        .filter((part) => part !== undefined && part.length > 0)
        .join(' '));
    graph.addRelationship({
        id: generateId('CONDITIONAL_ON', `${owner.id}->${target.id}:${annotation.line}:${resolvedName}:${detail ?? ''}`),
        sourceId: owner.id,
        targetId: target.id,
        type: 'CONDITIONAL_ON',
        confidence: 1,
        reason,
    });
}
const configNodesByGraph = new WeakMap();
function configNodesByKey(graph) {
    const cached = configNodesByGraph.get(graph);
    if (cached !== undefined)
        return cached;
    const byKey = new Map();
    for (const node of graph.iterNodes()) {
        if (node.label !== 'Property' ||
            typeof node.properties.description !== 'string' ||
            !node.properties.description.startsWith(SPRING_CONFIG_DESCRIPTION)) {
            continue;
        }
        const key = String(node.properties.name);
        const bucket = byKey.get(key) ?? [];
        bucket.push(node);
        byKey.set(key, bucket);
    }
    configNodesByGraph.set(graph, byKey);
    return byKey;
}
/**
 * Build a post-resolution Spring conditional attacher shared by language
 * adapters. Adapters capture syntax and package-visibility facts; this module
 * owns framework annotation semantics and graph representation.
 */
export function createSpringConditionalMetadataAttacher(adapter) {
    return (graph, parsedFiles, nodeLookup, indexes) => {
        const resolveAnnotation = createSpringAnnotationNameResolver(indexes);
        let propertyNodes;
        for (const parsed of parsedFiles) {
            const incomplete = adapter.isPackageVisibilityIncomplete(parsed.filePath);
            const resolvedAnnotations = new Map();
            for (const fact of adapter.getFacts(parsed.filePath)) {
                const owner = ownerGraphNode(fact, indexes, nodeLookup, graph);
                const ownerScope = indexes.scopeTree.getScope(fact.ownerScopeId);
                if (owner === undefined || ownerScope === undefined)
                    continue;
                for (const annotation of fact.annotations) {
                    const cacheKey = `${ownerScope.parent ?? '<root>'}\0${annotation.name}`;
                    let resolved = resolvedAnnotations.get(cacheKey);
                    if (!resolvedAnnotations.has(cacheKey)) {
                        resolved = resolveAnnotation(annotation.name, parsed, ownerScope.parent, RESOLVABLE_SPRING_CONDITIONAL_ANNOTATIONS, incomplete);
                        resolvedAnnotations.set(cacheKey, resolved);
                    }
                    if (resolved === undefined)
                        continue;
                    if (!CONDITIONAL_ANNOTATIONS.has(resolved))
                        continue;
                    if (PROPERTY_CONDITIONAL_ANNOTATIONS.has(resolved)) {
                        const keys = propertyConditionKeys(annotation.text);
                        propertyNodes ??= configNodesByKey(graph);
                        let matched = false;
                        for (const key of keys) {
                            for (const property of propertyNodes.get(key) ?? []) {
                                matched = true;
                                addConditionalRelationship(graph, owner, property, annotation, resolved, `key=${key}`);
                            }
                        }
                        if (matched)
                            continue;
                    }
                    const conditionNode = addConditionNode(graph, owner, annotation, resolved);
                    addConditionalRelationship(graph, owner, conditionNode, annotation, resolved);
                }
            }
        }
    };
}
