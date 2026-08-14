// gitnexus/src/core/ingestion/variable-extractors/configs/go.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
import { extractSimpleTypeName } from '../../type-extractors/shared.js';
/**
 * Go variable extraction config.
 *
 * Go has package-scoped var and const declarations:
 * - `var x int = 5`
 * - `const MaxSize = 100`
 * - `var ( ... )` grouped declarations
 *
 * tree-sitter-go uses:
 * - var_declaration → var_spec → identifier, type
 * - const_declaration → const_spec → identifier, type
 *
 * Visibility: uppercase first letter = exported (public), lowercase = unexported (package).
 */
function goVisibilityForName(name) {
    const firstChar = name.charAt(0);
    return firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()
        ? 'public'
        : 'package';
}
function collectGoSpecNames(spec) {
    const names = [];
    for (let i = 0; i < spec.namedChildCount; i++) {
        const child = spec.namedChild(i);
        if (!child)
            continue;
        if (child.type === 'identifier') {
            names.push(child.text);
            continue;
        }
        break;
    }
    return names;
}
function collectGoSpecs(node) {
    const specs = [];
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'var_spec' || child?.type === 'const_spec') {
            specs.push(child);
            continue;
        }
        if (child?.type === 'var_spec_list') {
            specs.push(...collectGoSpecs(child));
        }
    }
    return specs;
}
function collectGoDeclarationNames(node) {
    if (node.type === 'short_var_declaration') {
        const left = node.childForFieldName('left');
        if (left?.type !== 'expression_list')
            return [];
        return left.namedChildren
            .filter((child) => child.type === 'identifier')
            .map((child) => child.text);
    }
    const names = [];
    for (const spec of collectGoSpecs(node))
        names.push(...collectGoSpecNames(spec));
    return names;
}
function findGoSpecForName(node, name) {
    for (const spec of collectGoSpecs(node)) {
        if (collectGoSpecNames(spec).includes(name))
            return spec;
    }
    return undefined;
}
function extractGoSpecType(spec) {
    const typeNode = spec.childForFieldName('type');
    return typeNode ? (extractSimpleTypeName(typeNode) ?? typeNode.text?.trim()) : undefined;
}
function extractGoVarName(node) {
    const firstName = collectGoDeclarationNames(node)[0];
    if (firstName)
        return firstName;
    // var_declaration/const_declaration → var_spec/const_spec → identifier
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'var_spec' || child?.type === 'const_spec') {
            const name = child.childForFieldName('name');
            if (name)
                return name.text;
            // Fallback: first identifier child
            for (let j = 0; j < child.namedChildCount; j++) {
                const gc = child.namedChild(j);
                if (gc?.type === 'identifier')
                    return gc.text;
            }
        }
    }
    // short_var_declaration: x := 5 → expression_list → identifier
    if (node.type === 'short_var_declaration') {
        const left = node.childForFieldName('left');
        if (left?.type === 'expression_list') {
            const firstIdent = left.namedChildren.find((c) => c.type === 'identifier');
            if (firstIdent)
                return firstIdent.text;
        }
    }
    return undefined;
}
function extractGoVarType(node) {
    for (const spec of collectGoSpecs(node)) {
        const typeName = extractGoSpecType(spec);
        if (typeName)
            return typeName;
    }
    return undefined;
}
export const goVariableConfig = {
    language: SupportedLanguages.Go,
    constNodeTypes: ['const_declaration'],
    staticNodeTypes: [],
    variableNodeTypes: ['var_declaration', 'short_var_declaration'],
    extractName: extractGoVarName,
    extractType: extractGoVarType,
    extractTypeForName(node, name) {
        const spec = findGoSpecForName(node, name);
        return spec ? extractGoSpecType(spec) : undefined;
    },
    extractVisibility(node) {
        const name = extractGoVarName(node);
        if (!name)
            return 'package';
        // Go visibility: uppercase first letter = exported
        const firstChar = name.charAt(0);
        return firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()
            ? 'public'
            : 'package';
    },
    extractNames: collectGoDeclarationNames,
    extractVisibilityForName(_node, name) {
        return goVisibilityForName(name);
    },
    isConst(node) {
        return node.type === 'const_declaration';
    },
    isStatic(_node) {
        // Go does not have static declarations
        return false;
    },
    isMutable(node) {
        return node.type !== 'const_declaration';
    },
};
