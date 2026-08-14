import type { CaptureMatch } from '../../../../_shared/index.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Given a function_item node that is inside an impl_item, synthesize a
 * self-type-binding capture if the function has a `self_parameter`.
 *
 * The impl_item structure:
 *   impl [TraitName for] TypeName { fn method(&self) { ... } }
 */
export declare function synthesizeRustReceiverBinding(fnNode: SyntaxNode, implNode: SyntaxNode | null): CaptureMatch | null;
/**
 * Extract the target type from an impl_item.
 * `impl TypeName { ... }` → "TypeName"
 * `impl TraitName for TypeName { ... }` → "TypeName"
 */
export declare function getImplTargetType(implNode: SyntaxNode): string | null;
/**
 * Extract the trait name from an impl_item when it's `impl Trait for Type`.
 */
export declare function getImplTraitName(implNode: SyntaxNode): string | null;
