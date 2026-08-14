/**
 * Swift same-module (SPM target) implicit visibility for the
 * `populateNamespaceSiblings` hook.
 *
 * Swift gives every file in a module access to every other file's
 * top-level declarations WITHOUT any `import` statement (whole-module
 * visibility). This is the Swift analogue of Go's same-package sibling
 * visibility — `populateGoPackageSiblings` is the template.
 *
 * Module identity: Swift has no in-source `package X` marker. The SPM
 * target is a directory subtree (`Sources/<Target>/…`). Module membership
 * is threaded in via the SPM target map (`ctx.resolutionConfig` →
 * `coerceSwiftTargets`) and grouped by `groupSwiftFilesBySpmTarget`,
 * replicating legacy `wireSwiftImplicitImports`'s `groupSwiftFilesByTarget`:
 * files are grouped by SPM target subtree when a package config is present,
 * else ALL Swift files form one module (`__default__`,
 * single-Xcode-project assumption). Every `.swift` file in the same target
 * sees its siblings' top-level defs.
 *
 * Bindings are added through the append-only `bindingAugmentations`
 * channel (Contract Invariant I8) with `origin: 'namespace'`, exactly
 * like the Go implementation — `indexes.bindings` is frozen post-
 * finalize and must not be mutated.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
export declare function populateSwiftTargetSiblings(parsedFiles: readonly ParsedFile[], indexes: ScopeResolutionIndexes, ctx: {
    readonly fileContents: ReadonlyMap<string, string>;
    readonly resolutionConfig?: unknown;
}): void;
