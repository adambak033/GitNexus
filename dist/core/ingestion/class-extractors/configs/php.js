// gitnexus/src/core/ingestion/class-extractors/configs/php.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
export const phpClassConfig = {
    language: SupportedLanguages.PHP,
    typeDeclarationNodes: ['class_declaration', 'interface_declaration', 'enum_declaration'],
    ancestorScopeNodeTypes: ['namespace_definition'],
};
