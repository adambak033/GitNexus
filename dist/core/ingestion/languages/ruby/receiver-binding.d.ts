/**
 * Synthesize `@type-binding.self` captures for Ruby methods.
 *
 * Every instance method and singleton method inside a class or module body
 * gets `self` bound to the enclosing class/module name.  Ruby has no
 * `@staticmethod` concept — even `def self.foo` dispatches on the class.
 *
 * For `class << self` (singleton_class) blocks, we walk past the
 * singleton_class to the real owning class/module, matching the
 * `rubyResolveEnclosingOwner` logic from the legacy provider.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Walk up the parent chain from `node` to find the first enclosing
 * `class` or `module` ancestor.
 *
 * - `singleton_class` (`class << self`) is not itself a real type, so we
 *   skip past it and continue walking to find the true owner.
 * - Stops at `program` (never walks past the file root).
 * - Returns `null` when no enclosing class/module is found.
 */
export declare function findEnclosingClassOrModule(node: SyntaxNode): SyntaxNode | null;
/**
 * Given a method node (`method` or `singleton_method`) and its enclosing
 * `class`/`module` node (or null for top-level defs), synthesize a
 * `@type-binding.self` capture that binds `self` to the class/module name.
 *
 * Returns `null` when:
 * - `enclosingNode` is null (top-level def has no implicit receiver)
 * - the enclosing node's name cannot be extracted
 */
export declare function synthesizeRubyReceiverBinding(fnNode: SyntaxNode, enclosingNode: SyntaxNode | null): CaptureMatch | null;
