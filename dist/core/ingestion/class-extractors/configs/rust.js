// gitnexus/src/core/ingestion/class-extractors/configs/rust.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
export const rustClassConfig = {
    language: SupportedLanguages.Rust,
    typeDeclarationNodes: ['struct_item', 'enum_item'],
    ancestorScopeNodeTypes: ['mod_item', 'struct_item', 'enum_item'],
};
