import type { CaptureMatch } from '../../../../_shared/index.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Decompose a Rust `use_declaration` into individual import captures.
 * Handles simple paths, grouped imports ({A, B}), wildcards (*),
 * renames (as), and `pub use` re-exports.
 */
export declare function splitRustUseDeclaration(node: SyntaxNode): CaptureMatch[];
