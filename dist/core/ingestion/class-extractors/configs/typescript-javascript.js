// gitnexus/src/core/ingestion/class-extractors/configs/typescript-javascript.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
const shared = {
    typeDeclarationNodes: [
        'class_declaration',
        'abstract_class_declaration',
        'interface_declaration',
        'enum_declaration',
    ],
    ancestorScopeNodeTypes: [
        'class_declaration',
        'abstract_class_declaration',
        'interface_declaration',
        'enum_declaration',
    ],
};
export const typescriptClassConfig = {
    ...shared,
    language: SupportedLanguages.TypeScript,
};
export const javascriptClassConfig = {
    ...shared,
    language: SupportedLanguages.JavaScript,
};
export const vueClassConfig = {
    ...shared,
    language: SupportedLanguages.Vue,
};
