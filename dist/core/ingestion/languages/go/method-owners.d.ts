import type { ParsedFile } from '../../../../_shared/index.js';
/**
 * Populate `ownerId` on Go Method defs by matching receiver types
 * extracted from `@type-binding.self` captures against struct defs in
 * the module scope.
 *
 * Go method declarations are top-level (`func (r *T) M()`), not nested
 * inside a struct body. The generic `populateClassOwnedMembers` requires
 * the method's parent scope to be a `Class` scope, which never matches
 * Go. This pass bridges the gap by reading the self typeBinding that
 * `synthesizeGoReceiverBinding` creates, locating the matching struct
 * def, and stamping `ownerId` onto the Method def.
 */
export declare function populateGoOwners(parsed: ParsedFile): void;
export declare function populateGoWorkspaceOwners(parsedFiles: readonly ParsedFile[], ctx: {
    readonly fileContents: ReadonlyMap<string, string>;
}): void;
