// gitnexus/src/core/ingestion/class-extractors/configs/python.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
export const pythonClassConfig = {
    language: SupportedLanguages.Python,
    typeDeclarationNodes: ['class_definition'],
    ancestorScopeNodeTypes: ['class_definition'],
};
