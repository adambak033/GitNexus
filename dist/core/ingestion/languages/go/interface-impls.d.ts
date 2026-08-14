import type { ParsedFile } from '../../../../_shared/index.js';
import type { StructuralImplementationResult } from '../../scope-resolution/contract/scope-resolver.js';
import type { SemanticModel } from '../../model/semantic-model.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
/** Which method set satisfied an interface. `value` implies pointer too. */
export type GoReceiverForm = 'value' | 'pointer';
/** One structural implementor plus the form in which it implements. */
export type GoStructuralImplementor = {
    readonly structDefId: string;
    readonly receiverForm: GoReceiverForm;
};
export declare function detectGoInterfaceImplementations(parsedFiles: readonly ParsedFile[], _indexes: ScopeResolutionIndexes, _model: SemanticModel): StructuralImplementationResult;
