// gitnexus/src/core/ingestion/class-extractors/configs/swift.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
export const swiftClassConfig = {
    language: SupportedLanguages.Swift,
    typeDeclarationNodes: ['class_declaration', 'protocol_declaration'],
    ancestorScopeNodeTypes: ['class_declaration', 'protocol_declaration'],
    extractType(node) {
        if (node.type === 'protocol_declaration')
            return 'Interface';
        if (node.type !== 'class_declaration')
            return undefined;
        if (node.children.some((child) => child?.text === 'struct'))
            return 'Struct';
        if (node.children.some((child) => child?.text === 'enum'))
            return 'Enum';
        return 'Class';
    },
};
