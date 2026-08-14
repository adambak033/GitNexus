/**
 * `resolveImportTarget` adapter for the Dart `ScopeResolver`. Ports the
 * legacy-DAG Dart import logic (`import-resolvers/configs/dart.ts`):
 *
 *   - `dart:` SDK imports          → `null` (external, no edge)
 *   - `package:pkg/path`           → `lib/path` (or bare `path`) matched
 *                                     against the workspace file set
 *   - relative `'foo/bar.dart'`    → resolved against the importer's dir
 *   - `__heritage__:` markers      → `null` (synthetic heritage carrier,
 *                                     consumed by `emitDartHeritageEdges`)
 *
 * The `ScopeResolver` hook signature is `(targetRaw, fromFile, allFilePaths)`;
 * `targetRaw` arrives already quote-stripped from `interpretDartImport`.
 */
export declare function resolveDartImportTarget(targetRaw: string, fromFile: string, allFilePaths: ReadonlySet<string>): string | readonly string[] | null;
