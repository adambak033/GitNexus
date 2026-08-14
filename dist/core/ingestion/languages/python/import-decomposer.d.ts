/**
 * Decompose a Python `import_statement` / `import_from_statement` into
 * one `CaptureMatch` per imported name.
 *
 * Why split here? The `LanguageProvider.interpretImport` contract is
 * one `ParsedImport` per call. Tree-sitter delivers `import a, b as c`
 * and `from m import x, y, z` as a single match each, so without
 * decomposition we'd lose names. The synthesized markers
 * (`@import.kind` / `@import.name` / `@import.alias` / `@import.source`)
 * carry everything `interpretPythonImport` needs to recover the original
 * `ParsedImport` shape — see `interpret.ts`.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export declare function splitImportStatement(stmtNode: SyntaxNode): CaptureMatch[];
