/**
 * Interpret a C #include capture into a ParsedImport.
 * C includes are always wildcard imports (all symbols from the header).
 */
export function interpretCImport(captures) {
    const source = captures['@import.source']?.text;
    if (source === undefined)
        return null;
    // System headers (e.g. <stdio.h>) are not resolved to local files
    if (captures['@import.system'] !== undefined)
        return null;
    return { kind: 'wildcard', targetRaw: source };
}
/**
 * Interpret a C type-binding capture into a ParsedTypeBinding.
 */
export function interpretCTypeBinding(captures) {
    const name = captures['@type-binding.name']?.text;
    const type = captures['@type-binding.type']?.text;
    if (name === undefined || type === undefined)
        return null;
    let source = 'annotation';
    if (captures['@type-binding.parameter'] !== undefined) {
        source = 'parameter-annotation';
    }
    else if (captures['@type-binding.assignment'] !== undefined) {
        source = 'assignment-inferred';
    }
    return { boundName: name, rawTypeName: normalizeCTypeName(type), source };
}
/**
 * Normalize a C type name: strip pointer/array syntax, qualifiers.
 */
export function normalizeCTypeName(text) {
    let t = text.trim();
    // Strip const, volatile, restrict qualifiers
    t = t.replace(/\b(const|volatile|restrict|static|extern|inline)\b/g, '').trim();
    // Strip pointer stars
    while (t.endsWith('*'))
        t = t.slice(0, -1).trim();
    while (t.startsWith('*'))
        t = t.slice(1).trim();
    // Strip array brackets
    t = t.replace(/\[.*?\]/g, '').trim();
    // Strip struct/union/enum prefixes
    t = t.replace(/^(struct|union|enum)\s+/, '');
    return t;
}
