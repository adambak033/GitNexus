const DART_EXTENSION_TYPE_HEADER = /\b(extension)([ \t]+type[ \t]+(?:const[ \t]+)?)([A-Za-z_$][A-Za-z0-9_$]*)([ \t]*<[^()\r\n]*>)?([ \t]*)\(([^()\r\n]*)\)/g;
function representationType(representation) {
    const trimmed = representation.trim();
    const match = /^(.*\S)\s+[A-Za-z_$][A-Za-z0-9_$]*$/.exec(trimmed);
    const typeName = match?.[1]?.trim();
    return typeName && typeName.length > 0 ? typeName : null;
}
/**
 * Rewrites Dart 3.3 `extension type Name(Type value)` headers into ordinary
 * extension headers before tree-sitter sees the source. The vendored grammar
 * currently recovers these declarations through an ERROR subtree, while the
 * existing Dart ingestion path already handles `extension Name on Type`.
 */
export function preprocessDartExtensionTypes(sourceText) {
    return sourceText.replace(DART_EXTENSION_TYPE_HEADER, (match, extensionKeyword, extensionTypeGap, name, typeParameters, beforeRepresentation, representation) => {
        const typeName = representationType(representation);
        if (typeName === null)
            return match;
        const representationSpanLength = beforeRepresentation.length + representation.length + 2;
        const rewrittenRepresentation = ` on ${typeName}`;
        if (rewrittenRepresentation.length > representationSpanLength)
            return match;
        return (extensionKeyword +
            ' '.repeat(extensionTypeGap.length) +
            name +
            (typeParameters ?? '') +
            rewrittenRepresentation +
            ' '.repeat(representationSpanLength - rewrittenRepresentation.length));
    });
}
