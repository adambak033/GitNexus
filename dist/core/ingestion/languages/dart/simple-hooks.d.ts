/**
 * Small explicit Dart scope-resolution hooks:
 *
 *   - `dartBindingScopeFor` — (1) hoists `@type-binding.return` bindings to
 *     the Module scope so chain-follow + `propagateImportedReturnTypes` see
 *     them; (2) hoists function/method/constructor declaration NAMES to the
 *     enclosing parent scope. The second case is Dart-specific: because
 *     `function_signature`/`function_body` are siblings, the synthesized
 *     Function scope starts AT the declaration, so the central auto-hoist
 *     (which fires only when the declaration anchor range equals the scope
 *     range) does not trigger; without this the function name would bind
 *     inside its own body instead of being visible to callers/siblings.
 *   - `dartImportOwningScope` — imports attach to the Module scope only.
 *   - `dartReceiverBinding` — the implicit `this`/`super` receiver of a
 *     Function scope.
 */
import type { ParsedImport, Scope, ScopeId, ScopeTree, TypeRef, CaptureMatch } from '../../../../_shared/index.js';
export declare function dartBindingScopeFor(decl: CaptureMatch, innermost: Scope, tree: ScopeTree): ScopeId | null;
export declare function dartImportOwningScope(_imp: ParsedImport, innermost: Scope, _tree: ScopeTree): ScopeId | null;
export declare function dartReceiverBinding(functionScope: Scope): TypeRef | null;
