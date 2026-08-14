export const UNKNOWN_JVM_PACKAGE_FACT = Object.freeze({ status: 'unknown' });
/** Validate a package fact restored from an opaque worker payload. */
export function isJvmPackageFact(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const fact = value;
    return (fact.status === 'unknown' || (fact.status === 'known' && typeof fact.packageName === 'string'));
}
/**
 * Create one language-local package fact store.
 *
 * Package facts are captured while the language's scope extractor already
 * owns a tree-sitter Tree, then serialized through ParsedFile's side-channel.
 * Resolution hooks consume only this plain data and never parse source again.
 */
export function createJvmPackageFactStore(options) {
    const factsByFile = new Map();
    return {
        clear: () => factsByFile.clear(),
        capture: (filePath, root) => factsByFile.set(filePath, extractJvmPackageFact(root, options)),
        set: (filePath, fact) => factsByFile.set(filePath, fact),
        get: (filePath) => factsByFile.get(filePath),
    };
}
export function extractJvmPackageFact(root, options) {
    const packageNode = root.namedChildren.find((child) => child.type === options.packageNodeType);
    if (packageNode === undefined) {
        // A syntax error elsewhere in a default-package file does not make its
        // package ambiguous. Only a top-level ERROR that contains the reserved
        // package keyword is evidence of a malformed package header.
        const malformedHeader = root.namedChildren.some((child) => child.type === 'ERROR' && /\bpackage\b/.test(child.text));
        return malformedHeader ? UNKNOWN_JVM_PACKAGE_FACT : { status: 'known', packageName: '' };
    }
    const nameNode = packageNode.namedChildren.find((child) => options.packageNameNodeTypes.includes(child.type));
    const packageName = nameNode?.text.trim();
    if (packageNode.hasError || packageName === undefined || packageName.length === 0) {
        return UNKNOWN_JVM_PACKAGE_FACT;
    }
    return { status: 'known', packageName };
}
