// gitnexus/src/core/ingestion/class-extractors/configs/ruby.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
export const rubyClassConfig = {
    language: SupportedLanguages.Ruby,
    typeDeclarationNodes: ['class'],
    ancestorScopeNodeTypes: ['module', 'class'],
    // #1978: key nested-type nodes by their fully-qualified path (Outer.Inner) so
    // same-tail classes nested under different modules stay distinct.
    qualifiedNodeId: true,
};
