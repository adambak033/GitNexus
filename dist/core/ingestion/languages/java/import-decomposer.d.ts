/**
 * Decompose a Java `import_declaration` into a `CaptureMatch` carrying
 * the synthesized markers `@import.kind` / `@import.source` /
 * `@import.name` that `interpretJavaImport` consumes.
 *
 * Unlike C#'s using-directive decomposer, Java has four import forms:
 *
 *   import com.example.User;                     → named
 *   import com.example.*;                         → wildcard
 *   import static com.example.Utils.format;       → static
 *   import static com.example.Utils.*;             → static-wildcard
 *
 * Each produces exactly one import. The decomposer inspects the raw
 * source text and tree-sitter children to determine the flavor.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export declare function splitImportDeclaration(stmtNode: SyntaxNode): CaptureMatch | null;
