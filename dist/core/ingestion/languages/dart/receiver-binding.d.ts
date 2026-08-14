/**
 * Synthesize the implicit `this` (and `super`) receiver type-binding for a
 * Dart instance method — tree-sitter can't express the implicit receiver via
 * a static query pattern. Mirror of `languages/swift/receiver-binding.ts`,
 * adapted for Dart's grammar:
 *
 *   - The receiver name is `this` (Swift's `self`); `super` is the
 *     superclass receiver.
 *   - Dart's `function_signature`/`function_body` are SIBLINGS (not a
 *     `body:` field), so the caller passes the resolved `function_body`
 *     node explicitly as the anchor — anchoring the binding inside the body
 *     guarantees it lands in the (synthesized) Function scope, not the
 *     enclosing Class scope.
 *   - Static methods (`dartMethodConfig.isStatic`) and bodyless declarations
 *     get no receiver binding.
 */
import { type SyntaxNode } from '../../utils/ast-helpers.js';
import type { CaptureMatch } from '../../../../_shared/index.js';
/**
 * `declNode` is the method declaration wrapper (`method_signature` /
 * `declaration` / top-level `function_signature`). `bodyNode` is the
 * resolved sibling `function_body` (the anchor for Function-scope landing).
 */
export declare function synthesizeDartReceiverBinding(declNode: SyntaxNode, bodyNode: SyntaxNode): CaptureMatch[];
