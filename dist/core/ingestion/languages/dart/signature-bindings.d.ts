/**
 * Synthesize parameter-type and return-type bindings for a Dart function /
 * method. Mirror of `languages/swift/signature-bindings.ts`:
 *
 *   - Parameter bindings (`@type-binding.parameter`) are anchored on the
 *     `function_body` node so they land in the (synthesized) Function scope
 *     — the receiver of `param.method()` resolves against the param's type.
 *   - The return-type binding (`@type-binding.return`) is anchored on the
 *     declaration node and carries the function name → return type; the
 *     `bindingScopeFor` hook hoists it to the Module scope so callers (and
 *     `propagateImportedReturnTypes`) see `var u = getUser(); u.m()` resolve.
 *
 * Reuses `dartMethodConfig.extractParameters/extractName/extractReturnType`,
 * which descend the `method_signature`/`declaration` wrapper internally.
 */
import { type SyntaxNode } from '../../utils/ast-helpers.js';
import type { CaptureMatch } from '../../../../_shared/index.js';
/**
 * `declNode` is the declaration wrapper. `bodyNode` is the resolved sibling
 * `function_body` (or `null` for a bodyless/abstract declaration, in which
 * case only the return binding is emitted).
 */
export declare function synthesizeDartSignatureBindings(declNode: SyntaxNode, bodyNode: SyntaxNode | null): CaptureMatch[];
