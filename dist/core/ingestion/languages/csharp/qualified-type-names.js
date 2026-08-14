import { isClassLike } from '../../scope-resolution/scope/walkers.js';
function isTypeDef(def) {
    return isClassLike(def.type) || def.type === 'Enum';
}
export function populateCsharpNamespacePrefixes(parsed) {
    const scopesById = new Map();
    for (const scope of parsed.scopes)
        scopesById.set(scope.id, scope);
    // The file's declared namespace (file-scoped `namespace X;`). First Namespace
    // scope's own def qualifiedName; undefined when the file is namespace-free.
    const fileNamespace = (() => {
        for (const scope of parsed.scopes) {
            if (scope.kind !== 'Namespace')
                continue;
            const nsDef = scope.ownedDefs.find((d) => d.type === 'Namespace');
            const q = nsDef?.qualifiedName;
            if (q !== undefined && q.length > 0)
                return q;
        }
        return undefined;
    })();
    // Enclosing namespace path for a scope: nearest ancestor Namespace scope's
    // full qualifiedName, else the file-scoped namespace (Module-parented types).
    const namespaceOf = (scope) => {
        let parentId = scope.parent;
        while (parentId !== null) {
            const parent = scopesById.get(parentId);
            if (parent === undefined)
                break;
            if (parent.kind === 'Namespace') {
                const nsDef = parent.ownedDefs.find((d) => d.type === 'Namespace');
                const q = nsDef?.qualifiedName;
                if (q !== undefined && q.length > 0)
                    return q;
            }
            if (parent.kind === 'Module')
                return fileNamespace;
            parentId = parent.parent;
        }
        return fileNamespace;
    };
    for (const scope of parsed.scopes) {
        if (scope.kind !== 'Class')
            continue;
        const prefix = namespaceOf(scope);
        if (prefix === undefined || prefix.length === 0)
            continue;
        for (const def of scope.ownedDefs) {
            if (!isTypeDef(def))
                continue;
            if (def.namespacePrefix !== undefined)
                continue;
            const q = def.qualifiedName;
            if (q === prefix || (q !== undefined && q.startsWith(`${prefix}.`)))
                continue;
            def.namespacePrefix = prefix;
        }
    }
}
