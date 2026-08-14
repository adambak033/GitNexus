/**
 * Decompose a C# `using_directive` into a `CaptureMatch` carrying the
 * synthesized markers `@import.kind` / `@import.source` / `@import.name`
 * / `@import.alias` that `interpretCsharpImport` consumes.
 *
 * Unlike Python's decomposer this is 1:1 — each `using` produces exactly
 * one import. The split layer exists to expose the kind (namespace vs
 * alias vs static) without pushing raw-text parsing into `interpret.ts`.
 *
 *   using System;                           → namespace
 *   using System.Collections.Generic;       → namespace
 *   using Foo = System.Bar;                 → alias
 *   using static System.Math;               → static
 *   global using System.IO;                 → namespace (treated as file-scoped)
 *   using global::System.IO;                → namespace (global:: alias stripped)
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export declare function splitUsingDirective(stmtNode: SyntaxNode): CaptureMatch | null;
