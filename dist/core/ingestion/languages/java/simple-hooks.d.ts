/**
 * Small hooks for the Java provider. Each is a few lines; they make
 * the provider's choice explicit rather than relying on defaults.
 */
import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
/** Method return-type bindings hoist to Module scope so cross-file
 *  `propagateImportedReturnTypes` and chain-follow can find them. */
export declare function javaBindingScopeFor(decl: CaptureMatch, innermost: Scope, tree: ScopeTree): ScopeId | null;
/** Java imports are always at compilation-unit (Module) level (JLS §7.5).
 *  Return `null` unconditionally so the default Module scope is used. */
export declare function javaImportOwningScope(_imp: ParsedImport, _innermost: Scope, _tree: ScopeTree): ScopeId | null;
/** Look up `this` or `super` in the function scope's type bindings. */
export declare function javaReceiverBinding(functionScope: Scope): TypeRef | null;
