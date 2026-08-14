import type { ParsedFile, ScopeId } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
/**
 * Expand Go dot imports (`import . "pkg"`) into binding augmentations.
 *
 * Go dot imports are treated as wildcard imports in the scope model.
 * The shared `expandsWildcardTo` hook defaults to returning `[]` for Go
 * because it can't easily access the target module's exported defs
 * (it only receives a `ScopeId`). Instead we post-process wildcard
 * import edges and augment bindings with the target file's exported
 * (uppercase) defs — the same augmentation channel used by
 * `populateGoPackageSiblings` for same-package cross-file visibility.
 */
export declare function expandGoDotImports(parsedFiles: readonly ParsedFile[], indexes: ScopeResolutionIndexes): void;
export declare function expandGoWildcardNames(targetModuleScope: ScopeId, parsedFiles: readonly ParsedFile[]): readonly string[];
