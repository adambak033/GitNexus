import { makeScopeId } from '../../../../_shared/index.js';
import { bindSpringConfigConsumers, } from '../../frameworks/spring/config-bindings.js';
import { createSpringAnnotationNameResolver } from '../../frameworks/spring/bean-candidates.js';
import { parseSourceSafe } from '../../../tree-sitter/safe-parse.js';
import { nodeToCapture } from '../../utils/ast-helpers.js';
import { getJavaParser } from './query.js';
import { getJavaSpringConfigConsumerFacts } from './capture-side-channel.js';
import { isJavaPackageSiblingVisibilityIncomplete } from './package-siblings.js';
const VALUE_ANNOTATION = 'org.springframework.beans.factory.annotation.Value';
const CONFIGURATION_PROPERTIES_ANNOTATION = 'org.springframework.boot.context.properties.ConfigurationProperties';
function collectJavaImports(root) {
    const exact = new Set();
    const wildcard = new Set();
    const localTypes = new Set();
    for (const node of root.descendantsOfType('import_declaration')) {
        const imported = node.text
            .replace(/^\s*import\s+(?:static\s+)?/, '')
            .replace(/;\s*$/, '')
            .trim();
        if (imported.endsWith('.*'))
            wildcard.add(imported.slice(0, -2));
        else
            exact.add(imported);
    }
    for (const type of [
        'class_declaration',
        'interface_declaration',
        'enum_declaration',
        'record_declaration',
        'annotation_type_declaration',
    ]) {
        for (const node of root.descendantsOfType(type)) {
            const name = node.childForFieldName('name')?.text;
            if (name)
                localTypes.add(name);
        }
    }
    return { exact, wildcard, localTypes };
}
function annotationsOn(node) {
    const modifiers = node.namedChildren.find((child) => child.type === 'modifiers');
    if (modifiers === undefined)
        return [];
    const annotations = [];
    for (const child of modifiers.namedChildren) {
        if (child.type !== 'annotation' && child.type !== 'marker_annotation')
            continue;
        const name = child.childForFieldName('name')?.text ?? child.firstNamedChild?.text;
        if (name)
            annotations.push({ name, node: child });
    }
    return annotations;
}
function resolvesToAnnotation(rawName, canonicalName, imports) {
    if (rawName.includes('.'))
        return rawName === canonicalName;
    if (imports.localTypes.has(rawName))
        return false;
    if (imports.exact.has(canonicalName))
        return true;
    const packageName = canonicalName.slice(0, canonicalName.lastIndexOf('.'));
    return imports.wildcard.has(packageName);
}
function decodeJavaStringLiteral(literal) {
    const delimiterLength = literal.startsWith('"""') && literal.endsWith('"""') ? 3 : 1;
    return literal
        .slice(delimiterLength, -delimiterLength)
        .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
        .replace(/\\(["'\\btnfr])/g, (_match, escaped) => {
        const controls = {
            b: '\b',
            t: '\t',
            n: '\n',
            f: '\f',
            r: '\r',
        };
        return controls[escaped] ?? escaped;
    });
}
function javaStringLiterals(annotation) {
    return annotation
        .descendantsOfType('string_literal')
        .map((literal) => decodeJavaStringLiteral(literal.text));
}
/** Extract statically readable Spring placeholder keys from a Java annotation. */
export function parseValuePlaceholderKeys(annotation) {
    const keys = new Set();
    for (const literal of javaStringLiterals(annotation)) {
        for (const match of literal.matchAll(/\$\{([^{}]+)\}/g)) {
            const key = match[1].split(':', 1)[0].trim();
            if (/^[A-Za-z0-9_.-]+$/.test(key))
                keys.add(key);
        }
    }
    return [...keys];
}
/** Extract `prefix`/`value` (or the positional value) from the annotation. */
export function parseConfigurationPropertiesPrefix(annotation) {
    const named = annotation.descendantsOfType('element_value_pair').find((pair) => {
        const key = pair.childForFieldName('key')?.text;
        return key === 'prefix' || key === 'value';
    });
    const namedValue = named?.childForFieldName('value');
    const argumentsNode = annotation.childForFieldName('arguments');
    const literalNode = (namedValue?.type === 'string_literal'
        ? namedValue
        : namedValue?.descendantsOfType('string_literal')[0]) ??
        (named === undefined
            ? argumentsNode?.namedChildren.find((child) => child.type === 'string_literal')
            : undefined);
    if (literalNode === undefined)
        return null;
    const prefix = decodeJavaStringLiteral(literalNode.text)
        .trim()
        .replace(/^\.+|\.+$/g, '');
    return /^[A-Za-z0-9_.-]+$/.test(prefix) ? prefix : null;
}
function classScopeId(filePath, declaration) {
    return makeScopeId({
        filePath,
        range: nodeToCapture('@scope.class', declaration).range,
        kind: 'Class',
    });
}
function enclosingClass(node) {
    let current = node.parent;
    while (current !== null) {
        if (current.type === 'class_declaration' || current.type === 'record_declaration') {
            return current;
        }
        current = current.parent;
    }
    return undefined;
}
/** Collect config facts from the Java parser's existing AST (no reparse). */
export function captureJavaSpringConfigConsumerFacts(root, filePath) {
    const imports = collectJavaImports(root);
    const facts = [];
    for (const field of root.descendantsOfType('field_declaration')) {
        const annotations = annotationsOn(field).filter((annotation) => resolvesToAnnotation(annotation.name, VALUE_ANNOTATION, imports));
        if (annotations.length === 0)
            continue;
        const owner = enclosingClass(field);
        if (owner === undefined)
            continue;
        for (const declarator of field.namedChildren.filter((child) => child.type === 'variable_declarator')) {
            const fieldName = declarator.childForFieldName('name')?.text;
            if (!fieldName)
                continue;
            for (const annotation of annotations) {
                const keys = parseValuePlaceholderKeys(annotation.node);
                if (keys.length > 0) {
                    facts.push({
                        consumer: { kind: 'value', fieldName, line: field.startPosition.row + 1, keys },
                        annotationName: annotation.name,
                        classScopeId: classScopeId(filePath, owner),
                    });
                }
            }
        }
    }
    for (const type of ['class_declaration', 'record_declaration']) {
        for (const declaration of root.descendantsOfType(type)) {
            const className = declaration.childForFieldName('name')?.text;
            if (!className)
                continue;
            for (const annotation of annotationsOn(declaration)) {
                if (!resolvesToAnnotation(annotation.name, CONFIGURATION_PROPERTIES_ANNOTATION, imports)) {
                    continue;
                }
                const prefix = parseConfigurationPropertiesPrefix(annotation.node);
                if (prefix !== null) {
                    facts.push({
                        consumer: {
                            kind: 'configuration-properties',
                            className,
                            line: declaration.startPosition.row + 1,
                            prefix,
                        },
                        annotationName: annotation.name,
                        classScopeId: classScopeId(filePath, declaration),
                    });
                }
            }
        }
    }
    return facts;
}
/** Parse Java consumers for focused unit tests; production reuses the worker AST. */
export function extractJavaSpringConfigConsumers(source) {
    const tree = parseSourceSafe(getJavaParser(), source);
    return captureJavaSpringConfigConsumerFacts(tree.rootNode, '<memory>').map((fact) => fact.consumer);
}
/** Java ScopeResolver post-resolution hook for Spring configuration consumers. */
export function attachJavaSpringConfigBindings(graph, parsedFiles, _nodeLookup, indexes, _ctx) {
    const resolveAnnotation = createSpringAnnotationNameResolver(indexes);
    const recognizedAnnotations = new Set([VALUE_ANNOTATION, CONFIGURATION_PROPERTIES_ANNOTATION]);
    const batches = [];
    for (const parsed of parsedFiles) {
        const consumers = [];
        for (const fact of getJavaSpringConfigConsumerFacts(parsed.filePath)) {
            const classScope = indexes.scopeTree.getScope(fact.classScopeId);
            if (classScope === undefined || classScope.kind !== 'Class')
                continue;
            const expectedAnnotation = fact.consumer.kind === 'value' ? VALUE_ANNOTATION : CONFIGURATION_PROPERTIES_ANNOTATION;
            const enclosingScope = fact.consumer.kind === 'value' ? classScope.id : classScope.parent;
            const resolved = resolveAnnotation(fact.annotationName, parsed, enclosingScope, recognizedAnnotations, isJavaPackageSiblingVisibilityIncomplete(parsed.filePath));
            if (resolved === expectedAnnotation)
                consumers.push(fact.consumer);
        }
        if (consumers.length > 0)
            batches.push({ filePath: parsed.filePath, consumers });
    }
    bindSpringConfigConsumers(graph, batches);
}
