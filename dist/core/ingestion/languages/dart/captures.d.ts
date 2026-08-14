/**
 * `emitDartScopeCaptures` — the Dart scope-capture orchestrator (mirror of
 * `languages/swift/captures.ts`, adapted for tree-sitter-dart's grammar).
 *
 * It runs `DART_SCOPE_QUERY` for the constructs that map cleanly to a single
 * node (module/class scopes, type/method/field declarations, imports), then
 * synthesizes the Dart-specific streams the grammar can't express as a single
 * query node:
 *
 *   1. Function/method/constructor SCOPES — `function_signature`/`function_body`
 *      are SIBLINGS, so each Function scope is synthesized to span
 *      `signature.start .. body.end` (composed range); a constructor's body is
 *      a sibling of the wrapping `method_signature`.
 *   2. Receiver (`this`/`super`) + parameter + return type bindings, anchored
 *      inside the body so they land in the Function scope.
 *   3. Arity metadata on function-like declarations.
 *   4. Field type bindings (for receiver-chain resolution).
 *   5. References — calls (free/member/cascade) and member reads — from Dart's
 *      postfix `identifier (selector …)` chains, which have no
 *      `call_expression` node.
 *   6. Local-variable constructor/call-result type inference.
 *   7. Heritage — `extends` → `@reference.inherits` (the generic
 *      EXTENDS-by-target-kind pre-pass); `implements`/`with` → side-effect
 *      `__heritage__:` import markers consumed by `emitDartHeritageEdges`
 *      (Dart `implements <class>` must be IMPLEMENTS regardless of the
 *      target's symbol kind).
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
/**
 * `LanguageProvider.scopeOwnsReceivers` for Dart — the read side of
 * `dartShadowedFieldsCapture`, which is where the full rationale lives.
 *
 * Reads the marker rather than re-deriving anything: the names were computed at
 * capture time, where the AST is, and a `CaptureMatch` carries only
 * name/range/text. Kept beside the emitter so the tag string has exactly one
 * producer and one consumer, both in this file's line of sight.
 */
export declare function dartScopeOwnsReceivers(match: CaptureMatch): ReadonlySet<string> | undefined;
export declare function emitDartScopeCaptures(sourceText: string, _filePath: string, cachedTree?: unknown): readonly CaptureMatch[];
