import { splitQualifiedName } from '../utils/qualified-name.js';
const DEFAULT_SCOPE_NAME_NODE_TYPES = new Set([
    'nested_namespace_specifier',
    'scoped_identifier',
    'scoped_type_identifier',
    'qualified_name',
    'namespace_name',
    'namespace_identifier',
    'package_identifier',
    'type_identifier',
    'identifier',
    'name',
    'constant',
]);
const DEFAULT_TYPE_NAME_NODE_TYPES = new Set([
    'type_identifier',
    'identifier',
    'simple_identifier',
    'namespace_identifier',
    'constant',
    'name',
]);
const DEFAULT_LABEL_BY_NODE_TYPE = {
    class_declaration: 'Class',
    abstract_class_declaration: 'Class',
    interface_declaration: 'Interface',
    struct_declaration: 'Struct',
    record_declaration: 'Record',
    enum_declaration: 'Enum',
    class_definition: 'Class',
    struct_specifier: 'Struct',
    class_specifier: 'Class',
    enum_specifier: 'Enum',
    struct_item: 'Struct',
    enum_item: 'Enum',
    class: 'Class',
    object_declaration: 'Class',
    companion_object: 'Class',
    protocol_declaration: 'Interface',
    extension_declaration: 'Class',
};
const CLASS_LIKE_LABELS = new Set([
    'Class',
    'Struct',
    'Interface',
    'Enum',
    'Record',
]);
const extractScopeSegmentsFromNode = (scopeNode, scopeNameNodeTypes) => {
    const nameNode = scopeNode.childForFieldName?.('name') ??
        scopeNode.namedChildren?.find((child) => scopeNameNodeTypes.has(child.type));
    return nameNode ? splitQualifiedName(nameNode.text) : [];
};
const extractTypeNameFromNode = (node) => {
    const nameField = node.childForFieldName?.('name');
    if (nameField)
        return nameField.text;
    const nameChild = node.namedChildren?.find((child) => DEFAULT_TYPE_NAME_NODE_TYPES.has(child.type));
    return nameChild?.text;
};
const isClassLikeLabel = (label) => label !== undefined && label !== null && CLASS_LIKE_LABELS.has(label);
export function createClassExtractor(config) {
    const typeDeclarationSet = new Set(config.typeDeclarationNodes);
    const fileScopeSet = new Set(config.fileScopeNodeTypes ?? []);
    const ancestorScopeSet = new Set(config.ancestorScopeNodeTypes ?? []);
    const scopeNameNodeTypes = new Set([
        ...DEFAULT_SCOPE_NAME_NODE_TYPES,
        ...(config.scopeNameNodeTypes ?? []),
    ]);
    const buildQualifiedName = (node, simpleName) => {
        let root = node;
        while (root.parent)
            root = root.parent;
        const readScopeSegments = (scopeNode) => config.extractScopeSegments?.(scopeNode) ??
            extractScopeSegmentsFromNode(scopeNode, scopeNameNodeTypes);
        const fileScopeSegments = [];
        for (const child of root.namedChildren ?? []) {
            if (fileScopeSet.has(child.type)) {
                fileScopeSegments.push(...readScopeSegments(child));
            }
        }
        const ancestorScopes = [];
        let current = node.parent;
        while (current) {
            if (ancestorScopeSet.has(current.type)) {
                const segments = readScopeSegments(current);
                if (segments.length > 0)
                    ancestorScopes.push(segments);
            }
            current = current.parent;
        }
        return [
            ...fileScopeSegments,
            ...ancestorScopes.reverse().flat(),
            ...splitQualifiedName(simpleName),
        ]
            .filter(Boolean)
            .join('.');
    };
    const extract = (node, fallback) => {
        if (!typeDeclarationSet.has(node.type))
            return null;
        const name = config.extractName?.(node) ?? extractTypeNameFromNode(node) ?? fallback?.name;
        const type = config.extractType?.(node) ??
            DEFAULT_LABEL_BY_NODE_TYPE[node.type] ??
            (isClassLikeLabel(fallback?.type) ? fallback.type : undefined);
        if (!name || !type)
            return null;
        const templateArguments = config.extractTemplateArguments?.(node);
        return {
            name,
            type,
            qualifiedName: buildQualifiedName(node, name) || name,
            ...(templateArguments !== undefined ? { templateArguments } : {}),
        };
    };
    return {
        language: config.language,
        qualifiedNodeId: config.qualifiedNodeId ?? false,
        isTypeDeclaration(node) {
            return typeDeclarationSet.has(node.type);
        },
        extract,
        extractQualifiedName(node, simpleName) {
            return extract(node, { name: simpleName })?.qualifiedName ?? null;
        },
        // #1991: qualify a non-typeDeclaration scope node (e.g. a Ruby `module` → Trait)
        // by the same ancestor-scope walk the node-id path uses, so two same-tail nested
        // mixin modules stay distinct. extract()/extractQualifiedName cannot be reused —
        // they bail on non-typeDeclarations (a module is not in typeDeclarationNodes).
        qualifyScopeName(node, simpleName) {
            return buildQualifiedName(node, simpleName);
        },
        shouldSkipClassCapture(context) {
            return config.shouldSkipClassCapture?.(context) ?? false;
        },
        extractTemplateArgumentsFromCapture(context) {
            return config.extractTemplateArgumentsFromCapture?.(context);
        },
    };
}
