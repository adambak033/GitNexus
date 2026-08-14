/**
 * Decompose a PHP `namespace_use_declaration` into one or more
 * `CaptureMatch` objects carrying the synthesized markers
 * `@import.kind` / `@import.source` / `@import.name` / `@import.alias`
 * that `interpretPhpImport` consumes.
 *
 * PHP import forms handled:
 *
 *   use Foo\Bar;                      → namespace, localName=Bar
 *   use Foo\Bar as Baz;               → alias, localName=Baz
 *   use function Foo\bar;             → function, localName=bar
 *   use const Foo\BAR;                → const, localName=BAR
 *   use Foo\{A, B as C};              → grouped: one match per clause
 *   use function Foo\{f, g as h};     → grouped function variants
 *   use const Foo\{X, Y as Z};        → grouped const variants
 *
 * Unlike C#'s decomposer this is 1:N — each grouped use_declaration
 * fans out to one CaptureMatch per inner clause.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export type PhpImportKind = 'namespace' | 'alias' | 'function' | 'const';
/**
 * Decompose a `namespace_use_declaration` node into one `CaptureMatch`
 * per logical import. Returns `[]` when the node is unrecognized or
 * carries no resolvable clauses.
 */
export declare function splitNamespaceUseDeclaration(stmtNode: SyntaxNode): CaptureMatch[];
