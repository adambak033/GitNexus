import { type CaptureMatch } from '../../../../_shared/index.js';
import type { CaptureMap } from '../../language-provider.js';
import type { MethodExtractor } from '../../method-types.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/** Java records synthesize one public, zero-argument accessor per component. */
export declare const javaRecordMethodExtractor: MethodExtractor;
/** Scope declarations matching the structure-phase synthetic accessor nodes. */
export declare function synthesizeJavaRecordComponentAccessorCaptures(rootNode: SyntaxNode): CaptureMatch[];
/**
 * The structure query sees every record component. Suppress that synthetic
 * definition when the record body provides the canonical zero-argument
 * accessor explicitly, leaving the explicit method as the single authority.
 */
export declare function shouldSkipJavaRecordComponentDefinition(captureMap: CaptureMap): boolean;
