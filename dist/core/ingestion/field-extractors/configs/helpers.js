// gitnexus/src/core/ingestion/field-extractors/configs/helpers.ts
import { extractSimpleTypeName } from '../../type-extractors/shared.js';
// ---------------------------------------------------------------------------
// Modifier scanning
// ---------------------------------------------------------------------------
/**
 * Check whether any child of `node` (named or unnamed) has .text matching
 * the given `keyword`.
 *
 * Skips the `name` field child to avoid false positives when a method is
 * named after a contextual keyword (e.g. `abstract()` in TypeScript).
 */
export function hasKeyword(node, keyword) {
    const nameNode = node.childForFieldName('name');
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child || child === nameNode)
            continue;
        if (child.text.trim() === keyword)
            return true;
    }
    return false;
}
/**
 * Check whether a named child of type `modifierType` contains `keyword`.
 * Useful for languages that group modifiers under a wrapper node
 * (e.g. Java 'modifiers', Kotlin 'modifiers').
 */
export function hasModifier(node, modifierType, keyword) {
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && child.type === modifierType) {
            for (let j = 0; j < child.childCount; j++) {
                const mod = child.child(j);
                if (mod && mod.text.trim() === keyword)
                    return true;
            }
        }
    }
    return false;
}
/**
 * Collect `'@Name'`-prefixed annotation names from a declaration node's
 * modifier-wrapper children (e.g. Java `modifiers`). Handles both
 * `marker_annotation` (`@Autowired`) and `annotation`
 * (`@Autowired(required=false)`) node types. Node-type-agnostic: works for
 * any declaration (method, field, ...) that groups annotations under a
 * wrapper child of type `modifierType`.
 *
 * Shared by the JVM method- and field-extractor configs (moved verbatim from
 * `method-extractors/configs/jvm.ts` in PR #2200 U2).
 */
export function extractAnnotations(node, modifierType) {
    const annotations = [];
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && child.type === modifierType) {
            for (let j = 0; j < child.namedChildCount; j++) {
                const mod = child.namedChild(j);
                if (mod && (mod.type === 'marker_annotation' || mod.type === 'annotation')) {
                    const nameNode = mod.childForFieldName('name') ?? mod.firstNamedChild;
                    if (nameNode)
                        annotations.push('@' + nameNode.text);
                }
            }
        }
    }
    return annotations;
}
/**
 * Return the first matching visibility keyword found either as a direct keyword
 * child or inside a modifier wrapper node.
 * Skips the `name` field child (same rationale as hasKeyword).
 */
export function findVisibility(node, keywords, defaultVis, modifierNodeType) {
    const nameNode = node.childForFieldName('name');
    // Direct keyword children
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child || child === nameNode)
            continue;
        const text = child.text.trim();
        if (text && keywords.has(text))
            return text;
    }
    // Modifier wrapper
    if (modifierNodeType) {
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child && child.type === modifierNodeType) {
                for (let j = 0; j < child.childCount; j++) {
                    const mod = child.child(j);
                    const modText = mod?.text.trim();
                    if (modText && keywords.has(modText))
                        return modText;
                }
            }
        }
    }
    return defaultVis;
}
// ---------------------------------------------------------------------------
// Name and type extraction
// ---------------------------------------------------------------------------
/**
 * Extract the text of the first named child whose type is in `types`.
 */
export function firstChildText(node, types) {
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && types.has(child.type))
            return child.text;
    }
    return undefined;
}
/**
 * Extract the first named child node whose type is in `types`.
 */
export function firstChildOfType(node, types) {
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && types.has(child.type))
            return child;
    }
    return null;
}
/**
 * Get type text from a named field on the node, using extractSimpleTypeName.
 * Falls back to raw .text of the field child if extractSimpleTypeName returns undefined.
 */
export function typeFromField(node, fieldName) {
    const typeNode = node.childForFieldName(fieldName);
    if (!typeNode)
        return undefined;
    return extractSimpleTypeName(typeNode) ?? typeNode.text?.trim();
}
/**
 * Walk named children looking for a type_annotation node and extract its type.
 */
export function typeFromAnnotation(node) {
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && child.type === 'type_annotation') {
            const inner = child.firstNamedChild;
            if (inner)
                return extractSimpleTypeName(inner) ?? inner.text?.trim();
        }
    }
    return undefined;
}
/**
 * Find the first descendant (depth-first, one level) matching one of the given types
 * and return its text via extractSimpleTypeName.
 */
export function typeFromDescendant(node, types) {
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child)
            continue;
        if (types.has(child.type)) {
            return extractSimpleTypeName(child) ?? child.text?.trim();
        }
        // one more level
        for (let j = 0; j < child.namedChildCount; j++) {
            const grandchild = child.namedChild(j);
            if (grandchild && types.has(grandchild.type)) {
                return extractSimpleTypeName(grandchild) ?? grandchild.text?.trim();
            }
        }
    }
    return undefined;
}
/**
 * Collect all modifier keyword texts from a declaration node's named `modifier` children.
 * Used by C# configs to detect compound visibilities (protected internal, private protected).
 */
export function collectModifierTexts(node) {
    const result = new Set();
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && child.type === 'modifier') {
            result.add(child.text.trim());
        }
    }
    return result;
}
