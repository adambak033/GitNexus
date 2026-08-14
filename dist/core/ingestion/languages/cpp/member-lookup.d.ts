import type { ParsedFile, ReferenceSite, SymbolDefinition } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { GraphNodeLookup } from '../../scope-resolution/graph-bridge/node-lookup.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { SemanticModel } from '../../model/semantic-model.js';
import type { ReceiverMemberResolution } from '../../scope-resolution/contract/scope-resolver.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';
interface CapturedBaseEdge {
    readonly childName: string;
    readonly childQualifiedName?: string;
    readonly baseName: string;
    readonly baseQualifiedName?: string;
    readonly isVirtual: boolean;
}
interface CapturedMemberUsing {
    readonly childName: string;
    readonly childQualifiedName?: string;
    readonly baseName: string;
    readonly baseQualifiedName?: string;
    readonly memberName: string;
}
export interface CppMemberLookupSideChannel {
    readonly baseEdges: readonly CapturedBaseEdge[];
    readonly memberUsings: readonly CapturedMemberUsing[];
}
export declare function clearCppMemberLookupState(): void;
export declare function captureCppMemberLookupFacts(root: SyntaxNode, filePath: string): void;
export declare function collectCppMemberLookupSideChannel(filePath: string): CppMemberLookupSideChannel;
export declare function applyCppMemberLookupSideChannel(filePath: string, data: CppMemberLookupSideChannel): void;
export declare function buildCppMemberLookupMro(graph: KnowledgeGraph, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup): Map<string, string[]>;
export declare function resolveCppReceiverMember(ownerDef: SymbolDefinition, memberName: string, callsite: ReferenceSite, _scopes: ScopeResolutionIndexes, model: SemanticModel): ReceiverMemberResolution | undefined;
export {};
