/**
 * CommonJS module-export capture synthesis, shared by the JavaScript and
 * TypeScript emitters (#2723; TS parity per the #2729 review, F7).
 *
 * These declarations cannot come from the tree-sitter queries: the anonymous
 * default export takes its name from the FILE, which a query pattern cannot
 * see. They therefore had to be synthesized in the emitter — and living only in
 * `javascript/captures.ts` meant a `.ts` file emitted the default-export NODE
 * (the query and `labelOverride` are wired on both providers) while nothing
 * ever declared it. That is precisely the "found, zero callers" half-fix state
 * this issue set out to remove, reintroduced for TypeScript.
 *
 * Every grammar node named here exists in both `tree-sitter-javascript` and
 * `tree-sitter-typescript`, so one implementation serves both.
 *
 * Pure given the input nodes. No I/O, no globals.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Synthesize re-export markers for CJS forwarding assignments (#2723).
 *
 *   const lib = require('./lib');
 *   exports.forwarded = lib.imported;   // re-export of `imported` from ./lib
 *   const { imported } = require('./lib');
 *   exports.alsoForwarded = imported;   // same, through a named binding
 *
 * The right-hand side is an existing symbol rather than a function literal, so
 * no definition rule reaches it and importers of `forwarded` resolved to
 * nothing. Emitted with the `named-alias` vocabulary the destructured
 * `require()` form already uses, so `interpretJsImport` needs no new case.
 *
 * `exports.foo = localFn` (a locally DECLARED function) is deliberately not
 * handled here: the module scope already binds `localFn`, importers already
 * resolve through it, and synthesizing a second binding would re-create the
 * ambiguity the shadow guard exists to prevent.
 */
export declare function synthesizeCjsReExports(root: SyntaxNode, out: CaptureMatch[]): void;
/**
 * Synthesize the scope declaration for `module.exports = <function>` (#2723).
 *
 * The graph node for this comes from the definition query, but the scope query
 * cannot produce its name: an anonymous default export takes its name from the
 * FILE, which a tree-sitter pattern has no access to. Without a declaration the
 * node exists and nothing resolves to it — the half-fixed state this issue's
 * first commit already had to correct once.
 *
 * A named function expression (`module.exports = function named() {}`) keeps
 * its own name; the anonymous forms use `deriveDefaultExportHocName`, the
 * convention already applied to anonymous default exports elsewhere.
 */
export declare function synthesizeCjsDefaultExport(root: SyntaxNode, filePath: string, out: CaptureMatch[]): void;
/** Run every CommonJS export-capture synthesis pass for one file. */
export declare function synthesizeCjsModuleExports(root: SyntaxNode, filePath: string, out: CaptureMatch[]): void;
