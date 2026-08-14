/**
 * Enumerate the names a Dart `import '...'` brings into scope — every PUBLIC
 * top-level symbol of the target library. Dart imports are whole-library
 * (wildcard) and library-private (leading-underscore) members are not
 * exported, so they are filtered out. Mirror of Ruby's
 * `expandRubyWildcardNames`.
 *
 * Without this hook the shared `propagateImportedReturnTypes` pass has no
 * importer-scope binding to hang an imported function's return type on, so a
 * cross-file `var u = getUser(); u.save()` never resolves `u`'s type.
 */
import type { ParsedFile, ScopeId } from '../../../../_shared/index.js';
export declare function expandDartWildcardNames(targetModuleScope: ScopeId, parsedFiles: readonly ParsedFile[]): readonly string[];
