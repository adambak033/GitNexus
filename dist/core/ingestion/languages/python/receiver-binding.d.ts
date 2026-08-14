/**
 * Synthesize implicit receiver and constructor-assigned field type bindings
 * for methods.
 *
 * Tree-sitter can't easily express "the first parameter of a function
 * defined directly inside a class body" via a single static query.
 * Doing this in code keeps the embedded scope query declarative and
 * lets us encode the `@classmethod` / `@staticmethod` decorator
 * awareness that Python's runtime depends on.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Build a `@type-binding.self` (instance method) or `@type-binding.cls`
 * (`@classmethod`) match for `fnNode`, or `null` if `fnNode` is not a
 * method, is `@staticmethod`, or has no parameters.
 *
 * The caller is responsible for guaranteeing `fnNode.type ===
 * 'function_definition'`.
 */
export declare function synthesizeReceiverTypeBinding(fnNode: SyntaxNode): CaptureMatch | null;
/**
 * Synthesize class-scope field bindings for the common Python constructor
 * injection patterns:
 *
 *   def __init__(self, service: Service):
 *       self.service = service        # from the PARAMETER's annotation
 *       self.cache: Cache = build()   # from the FIELD's own annotation
 *       self.outer = Outer()          # from the CONSTRUCTOR called (#2807)
 *
 * The three tiers rank in that order — an explicit field annotation beats a
 * parameter annotation, which beats a construction. Anything else is still
 * refused: the receiver resolver needs positive evidence, not a name-only
 * guess from an arbitrary RHS.
 */
export declare function synthesizeConstructorFieldTypeBindings(fnNode: SyntaxNode): CaptureMatch[];
