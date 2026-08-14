// gitnexus/src/core/ingestion/class-extractors/configs/csharp.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
export const csharpClassConfig = {
    language: SupportedLanguages.CSharp,
    typeDeclarationNodes: [
        'class_declaration',
        'interface_declaration',
        'struct_declaration',
        'enum_declaration',
        'record_declaration',
    ],
    fileScopeNodeTypes: ['file_scoped_namespace_declaration'],
    ancestorScopeNodeTypes: [
        'namespace_declaration',
        'class_declaration',
        'interface_declaration',
        'struct_declaration',
        'enum_declaration',
        'record_declaration',
    ],
};
