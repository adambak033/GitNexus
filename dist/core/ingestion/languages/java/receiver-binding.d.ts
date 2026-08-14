/**
 * Synthesize `@type-binding.self` captures for Java instance methods —
 * one for `this` (always on non-static methods inside a type
 * declaration) and optionally one for `super` (only on class methods
 * when the enclosing class has a `superclass`).
 *
 * Mirrors `languages/csharp/receiver-binding.ts` in structure.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export declare function synthesizeJavaReceiverBinding(fnNode: SyntaxNode): CaptureMatch[];
