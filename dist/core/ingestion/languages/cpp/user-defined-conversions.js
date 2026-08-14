import { normalizeCppParamType } from './arity-metadata.js';
const userDefinedConversions = new Set();
const pendingUserDefinedConversions = [];
const classIdentitiesBySimpleName = new Map();
export function clearCppUserDefinedConversions() {
    userDefinedConversions.clear();
    pendingUserDefinedConversions.length = 0;
    classIdentitiesBySimpleName.clear();
}
export function hasCppUserDefinedConversion(argType, paramType) {
    return userDefinedConversions.has(conversionKey(argType, paramType));
}
export function populateCppUserDefinedConversions(parsed) {
    const scopesById = new Map();
    for (const scope of parsed.scopes)
        scopesById.set(scope.id, scope);
    for (const classScope of parsed.scopes) {
        if (classScope.kind !== 'Class')
            continue;
        const classDef = classScope.ownedDefs.find(isClassLike);
        if (classDef !== undefined)
            recordClassIdentity(classDef);
    }
    for (const classScope of parsed.scopes) {
        if (classScope.kind !== 'Class')
            continue;
        const classDef = classScope.ownedDefs.find(isClassLike);
        if (classDef === undefined)
            continue;
        const className = normalizedSimpleName(classDef);
        if (className === '')
            continue;
        const methodDefs = collectClassMethodDefs(classScope.id, parsed, scopesById);
        for (const def of methodDefs) {
            const simpleName = simpleNameOf(def);
            if (simpleName === className && def.parameterTypes?.length === 1) {
                if (def.isExplicit === true)
                    continue;
                registerPendingCppUserDefinedConversion(def.parameterTypes[0], className, className);
            }
        }
    }
    rebuildCppUserDefinedConversions();
}
export function registerCppUserDefinedConversion(argType, paramType) {
    if (argType === '' || paramType === '')
        return;
    if (argType === paramType)
        return;
    userDefinedConversions.add(conversionKey(argType, paramType));
}
function collectClassMethodDefs(classScopeId, parsed, scopesById) {
    const methods = [];
    const classScope = scopesById.get(classScopeId);
    if (classScope === undefined)
        return methods;
    for (const def of classScope.ownedDefs) {
        if (isCallableMember(def))
            methods.push(def);
    }
    for (const scope of parsed.scopes) {
        if (scope.parent !== classScopeId)
            continue;
        if (scope.kind === 'Class')
            continue;
        for (const def of scope.ownedDefs) {
            if (isCallableMember(def))
                methods.push(def);
        }
    }
    return methods;
}
function conversionKey(argType, paramType) {
    return `${argType}\0${paramType}`;
}
function registerPendingCppUserDefinedConversion(argType, paramType, ownerClassName) {
    if (argType === '' || paramType === '')
        return;
    if (argType === paramType)
        return;
    pendingUserDefinedConversions.push({ argType, paramType, ownerClassName });
}
function rebuildCppUserDefinedConversions() {
    userDefinedConversions.clear();
    for (const conversion of pendingUserDefinedConversions) {
        if (isAmbiguousClassName(conversion.ownerClassName))
            continue;
        userDefinedConversions.add(conversionKey(conversion.argType, conversion.paramType));
    }
}
function recordClassIdentity(def) {
    const simpleName = normalizedSimpleName(def);
    if (simpleName === '')
        return;
    const identities = classIdentitiesBySimpleName.get(simpleName) ?? new Set();
    identities.add(normalizedQualifiedClassName(def));
    classIdentitiesBySimpleName.set(simpleName, identities);
}
function isAmbiguousClassName(simpleName) {
    return (classIdentitiesBySimpleName.get(simpleName)?.size ?? 0) > 1;
}
function normalizedQualifiedClassName(def) {
    const qualifiedName = def.qualifiedName ?? simpleNameOf(def);
    if (qualifiedName === '' || !qualifiedName.includes('.'))
        return `${def.filePath}:${def.nodeId}`;
    return qualifiedName
        .split('.')
        .map((part) => normalizeCppParamType(part))
        .join('.');
}
function normalizedSimpleName(def) {
    return normalizeCppParamType(simpleNameOf(def));
}
function simpleNameOf(def) {
    return def.qualifiedName?.split('.').pop() ?? def.qualifiedName ?? '';
}
function isClassLike(def) {
    return def.type === 'Class' || def.type === 'Struct' || def.type === 'Interface';
}
function isCallableMember(def) {
    return def.type === 'Method' || def.type === 'Constructor';
}
