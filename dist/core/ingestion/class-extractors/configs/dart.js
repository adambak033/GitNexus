// gitnexus/src/core/ingestion/class-extractors/configs/dart.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
export const dartClassConfig = {
    language: SupportedLanguages.Dart,
    typeDeclarationNodes: ['class_definition', 'extension_declaration', 'enum_declaration'],
    ancestorScopeNodeTypes: ['class_definition', 'extension_declaration', 'enum_declaration'],
};
