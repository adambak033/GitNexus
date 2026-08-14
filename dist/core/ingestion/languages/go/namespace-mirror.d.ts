import type { ParsedFile } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { WorkspaceResolutionIndex } from '../../scope-resolution/workspace-index.js';
/**
 * Mirror exported typeBindings from namespace-import target modules
 * into the importer's module scope.
 *
 * Go uses namespace imports (`import "pkg"`) where the target package's
 * exported symbols are visible as `pkg.Func`. For cross-package return-type
 * resolution to work, the importer needs the target package's exported
 * typeBindings (e.g. `NewUser → User`) mirrored into its own module scope.
 *
 * Exported-symbol filter: Go uses uppercase first letter for exported names.
 */
export declare function mirrorGoNamespaceTypeBindings(parsedFiles: readonly ParsedFile[], indexes: ScopeResolutionIndexes, workspaceIndex: WorkspaceResolutionIndex): void;
