// gitnexus/src/core/ingestion/variable-extractors/configs/swift.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
import { extractSimpleTypeName } from '../../type-extractors/shared.js';
/**
 * Swift variable extraction config.
 *
 * Swift has top-level let/var declarations:
 * - `let maxSize = 100`
 * - `var counter = 0`
 * - `public let apiKey: String = "..."`
 *
 * tree-sitter-swift uses:
 * - property_declaration for both class and top-level declarations
 */
function extractSwiftVarName(node) {
    // property_declaration → pattern → ... → simple_identifier / identifier
    const pattern = node.namedChildren.find((c) => c.type === 'pattern');
    if (pattern) {
        const ident = pattern.namedChildren.find((c) => c.type === 'simple_identifier' || c.type === 'identifier');
        if (ident)
            return ident.text;
    }
    // Fallback: look for simple_identifier directly
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'simple_identifier')
            return child.text;
    }
    return undefined;
}
function extractSwiftVarType(node) {
    // Look for type_annotation child
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'type_annotation') {
            const typeNode = child.firstNamedChild;
            if (typeNode)
                return extractSimpleTypeName(typeNode) ?? typeNode.text?.trim();
        }
    }
    return undefined;
}
function hasSwiftKeyword(node, keyword) {
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.text === keyword)
            return true;
    }
    return false;
}
const SWIFT_VISIBILITY = new Set(['public', 'private', 'internal', 'fileprivate', 'open']);
export const swiftVariableConfig = {
    language: SupportedLanguages.Swift,
    constNodeTypes: [],
    staticNodeTypes: [],
    variableNodeTypes: ['property_declaration'],
    extractName: extractSwiftVarName,
    extractType: extractSwiftVarType,
    extractVisibility(node) {
        // Check modifiers for visibility keywords
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child?.type === 'modifiers') {
                for (let j = 0; j < child.childCount; j++) {
                    const mod = child.child(j);
                    if (mod && SWIFT_VISIBILITY.has(mod.text))
                        return mod.text;
                }
            }
        }
        // Direct keyword check
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && SWIFT_VISIBILITY.has(child.text))
                return child.text;
        }
        return 'internal'; // Swift default visibility
    },
    isConst(node) {
        return hasSwiftKeyword(node, 'let');
    },
    isStatic(node) {
        return hasSwiftKeyword(node, 'static') || hasSwiftKeyword(node, 'class');
    },
    isMutable(node) {
        return hasSwiftKeyword(node, 'var');
    },
};
