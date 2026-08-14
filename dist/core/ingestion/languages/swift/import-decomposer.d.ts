/**
 * Decompose a Swift `import_declaration` into a `CaptureMatch` carrying
 * the synthesized markers `@import.kind` / `@import.source` /
 * `@import.name` / `@import.testable` that `interpretSwiftImport`
 * consumes.
 *
 * Swift imports are whole-module (no named members), so this is 1:1 —
 * one `import` produces exactly one import. The split layer exposes the
 * module name and the `@testable` flag without pushing raw-text parsing
 * into `interpret.ts`.
 *
 *   import Foundation        → kind=namespace, source=Foundation
 *   import Foo.Bar           → kind=namespace, source=Foo (SPM target),
 *                              name=Foo.Bar (full path, for reference)
 *   @testable import MyApp   → kind=namespace, source=MyApp, testable=1
 *
 * Verified against tree-sitter-swift 0.7.1:
 *   (import_declaration
 *     (modifiers (attribute (user_type (type_identifier))))?   ; @testable / @_exported
 *     (identifier (simple_identifier)+))                        ; one per dotted segment
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export declare function splitSwiftImport(stmtNode: SyntaxNode): CaptureMatch | null;
