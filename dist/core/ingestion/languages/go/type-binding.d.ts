import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export declare function synthesizeGoTypeBindings(rootNode: SyntaxNode): CaptureMatch[];
export declare function extractSimpleTypeNameText(node: SyntaxNode): string;
