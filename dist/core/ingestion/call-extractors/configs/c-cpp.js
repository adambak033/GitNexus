// gitnexus/src/core/ingestion/call-extractors/configs/c-cpp.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
export const cCallConfig = {
    language: SupportedLanguages.C,
};
export const cppCallConfig = {
    language: SupportedLanguages.CPlusPlus,
    extractLanguageCallSite(callNode) {
        return extractCppOperatorCallSite(callNode);
    },
};
function extractCppOperatorCallSite(callNode) {
    if (callNode.type !== 'binary_expression')
        return null;
    if (isPrimitiveOnlyBinaryOperatorCall(callNode))
        return null;
    const operator = callNode.childForFieldName('operator')?.text.trim();
    // Keep the legacy DAG conservative: only simple identifier operands are
    // modeled here. Complex expressions stay unresolved instead of guessed.
    if (operator === '+') {
        const left = callNode.childForFieldName('left');
        const right = callNode.childForFieldName('right');
        if (left?.type !== 'identifier' || right?.type !== 'identifier')
            return null;
        return {
            calledName: 'operator+',
            callForm: 'member',
            receiverName: left.text,
            argCount: 1,
        };
    }
    if (operator === '<<') {
        const right = callNode.childForFieldName('right');
        if (right?.type !== 'identifier')
            return null;
        return {
            calledName: 'operator<<',
            callForm: 'free',
            argCount: 2,
        };
    }
    return null;
}
function isPrimitiveOnlyBinaryOperatorCall(callNode) {
    const left = callNode.childForFieldName('left');
    const right = callNode.childForFieldName('right');
    if (left === null || right === null)
        return false;
    return isBuiltinOperatorOperand(left) && isBuiltinOperatorOperand(right);
}
function isBuiltinOperatorOperand(node) {
    return isBuiltinOperatorType(inferCppOperatorOperandType(node));
}
function inferCppOperatorOperandType(node) {
    const literalType = inferCppLiteralType(node);
    if (literalType !== '')
        return literalType;
    if (node.type === 'identifier')
        return lookupCppIdentifierType(node);
    return '';
}
function inferCppLiteralType(node) {
    if (node.type === 'number_literal')
        return node.text.includes('.') ? 'double' : 'int';
    if (node.type === 'char_literal')
        return 'char';
    if (node.type === 'true' || node.type === 'false')
        return 'bool';
    return '';
}
function lookupCppIdentifierType(identNode) {
    const varName = identNode.text;
    let scope = identNode.parent;
    while (scope !== null &&
        scope.type !== 'compound_statement' &&
        scope.type !== 'translation_unit') {
        scope = scope.parent;
    }
    if (scope === null)
        return '';
    const parameterType = lookupCppFunctionParameterType(scope, varName);
    if (parameterType !== '')
        return parameterType;
    for (let i = 0; i < scope.childCount; i++) {
        const stmt = scope.child(i);
        if (stmt === null || stmt.type !== 'declaration')
            continue;
        const typeNode = stmt.childForFieldName('type');
        const declarator = stmt.childForFieldName('declarator');
        if (typeNode === null || declarator === null)
            continue;
        if (extractDeclaratorLeafName(declarator) === varName)
            return normalizeCppTypeText(typeNode.text);
    }
    return '';
}
function lookupCppFunctionParameterType(scope, varName) {
    let node = scope.parent;
    while (node !== null) {
        if (node.type === 'function_definition' || node.type === 'function_declarator') {
            const fnDecl = node.type === 'function_declarator'
                ? node
                : findFirstDescendantOfType(node, 'function_declarator');
            const params = fnDecl?.childForFieldName('parameters') ?? null;
            if (params === null)
                return '';
            for (let i = 0; i < params.namedChildCount; i++) {
                const param = params.namedChild(i);
                if (param === null || param.type !== 'parameter_declaration')
                    continue;
                const declarator = param.childForFieldName('declarator');
                const typeNode = param.childForFieldName('type');
                if (declarator !== null &&
                    typeNode !== null &&
                    extractDeclaratorLeafName(declarator) === varName) {
                    return normalizeCppTypeText(typeNode.text);
                }
            }
            return '';
        }
        node = node.parent;
    }
    return '';
}
function findFirstDescendantOfType(node, type) {
    if (node.type === type)
        return node;
    for (let i = 0; i < node.namedChildCount; i++) {
        const found = findFirstDescendantOfType(node.namedChild(i), type);
        if (found !== null)
            return found;
    }
    return null;
}
function extractDeclaratorLeafName(node) {
    if (node.type === 'identifier' ||
        node.type === 'field_identifier' ||
        node.type === 'operator_name') {
        return node.text;
    }
    const named = node.namedChildren;
    for (let i = named.length - 1; i >= 0; i--) {
        const name = extractDeclaratorLeafName(named[i]);
        if (name !== '')
            return name;
    }
    return '';
}
function normalizeCppTypeText(text) {
    return text
        .replace(/\b(const|volatile|static|extern|register|mutable|inline|constexpr)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function isBuiltinOperatorType(type) {
    return (type === 'bool' ||
        type === 'char' ||
        type === 'double' ||
        type === 'float' ||
        type === 'int' ||
        type === 'long' ||
        type === 'short' ||
        type === 'signed' ||
        type === 'unsigned');
}
