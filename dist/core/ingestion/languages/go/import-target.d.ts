/**
 * Resolve a Go import path to ALL .go files in the matching package directory.
 *
 * Go packages are directory-scoped: one import statement brings in every
 * (non-test) .go file in the package directory. Return all matching files so
 * the shared finalize pass creates one ImportEdge per file — enabling both
 * IMPORTS edge fanout AND binding materialization for every exported symbol in
 * the package.
 *
 * Strategy (first match wins):
 *   1. go.mod-based: strip module prefix, match package directory
 *   2. Non-go.mod / GOPATH: progressively shorter directory suffixes
 */
export declare function resolveGoImportTarget(targetRaw: string, _fromFile: string, allFilePaths: ReadonlySet<string>, resolutionConfig?: unknown): string | readonly string[] | null;
