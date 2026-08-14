/**
 * "Which files live DIRECTLY inside a directory whose path ends with
 * `<pkgPath>`?" — the query Go's package resolution and C#'s namespace-directory
 * fallback both answered with a full `allFilePaths` scan per import.
 *
 * Both scans ran the same predicate: normalize to forward slashes, apply the
 * language's extension filter, find the FIRST `'/' + pkgPath + '/'` occurrence,
 * and keep the file only if nothing after that occurrence contains a slash.
 *
 * That predicate depends only on the file's DIRECTORY, so it can be answered
 * from an index built once per file set:
 *
 *   let D = '/' + <normalized dir of the file> + '/'
 *   let P = '/' + pkgPath + '/'
 *   match ⟺ D.endsWith(P)
 *
 * It used to say one more thing, and #2881 removed it:
 *
 *   match ⟺ D.length >= P.length && D.indexOf(P) === D.length - P.length
 *
 * — i.e. `D` ends with `P` AND that trailing occurrence is the FIRST one, so
 * `a/pkg/b/pkg/x.go` did NOT answer `pkg`. The second half was never a rule
 * anyone chose. It is what the pre-index per-import scan happened to compute
 * (it called `indexOf`, then checked that nothing after the match contained a
 * slash), and the index was built to reproduce that scan byte for byte. It
 * dropped exactly the repositories that nest a directory name inside itself:
 * `internal/…/internal`, `Models/…/Models`, and the reported shape
 * `data/src/main/kotlin/com/example/data/Repo.kt`, where `import data.helper`
 * resolved to null. Kotlin was fixed first, in its own `dirChildren`
 * (`languages/kotlin/import-target.ts`); this index, the C# csproj index and
 * the legacy `go.ts` scan followed.
 *
 * The strongest evidence that the rule was accidental is that a sixth
 * implementation of the same question never had it. `import-resolvers/jvm.ts`
 * answers "files directly inside a directory ending with <packagePath>" for
 * Java and Kotlin wildcard imports, and has used `lastIndexOf` since #488.
 *
 * That is evidence about how the predicate was WRITTEN, not about live
 * behaviour, and the distinction matters enough to spell out. `jvm.ts` is
 * reached only through `provider.importResolver`, which `languages/java.ts` and
 * `languages/kotlin.ts` do wire — but that field currently has no production
 * READER. Its only reader anywhere is `import-target-adapter.ts`, whose own
 * docblock says it is "threaded through `finalizeScopeModel`"; nothing threads
 * it, and neither that module nor its two exports
 * (`buildImportTargetWorkspace`, `resolveImportTargetAcrossLanguages`) is
 * referenced outside its own unit test. So `jvm.ts`'s `resolveJvmWildcard` and
 * `import-resolvers/go.ts`'s `resolveGoPackage` are dormant, while THIS index,
 * `csharp.ts`'s `resolveCSharpImportInternal` and Kotlin's `dirChildren` are
 * the ones that run. Whether those two dormant resolvers should be deleted or
 * actually wired up is an open question and wants its own issue; it is not
 * settled here.
 *
 * The argument survives that correction intact, because it never needed the
 * resolvers to be live: an independent implementation of the same question,
 * written without reference to the pre-index scan, reached for `lastIndexOf`.
 * The extra clause was never a rule anyone chose. All six spellings now agree.
 *
 * The length guard the `indexOf` form needed is gone with it: `endsWith` is
 * false for a shorter `D` instead of comparing -1 to -1.
 *
 * Candidates are narrowed by the directory's LAST segment rather than by
 * indexing every directory suffix: a suffix map costs O(files × depth) entries,
 * which is exactly the memory this codebase runs out of at kernel scale
 * (#2649), while the last-segment bucket is O(directories) and is a superset of
 * the matches (`D` ends with `P` ⟹ the dir's last segment is `pkgPath`'s last
 * segment).
 *
 * Results keep Set-iteration order via the recorded `ord`, because the callers'
 * scans emitted in that order and Go returns the whole list as the import
 * target (one `ImportEdge` per file).
 *
 * Each language owns its own `WeakMap` memo and `accept` predicate, so the
 * STORED index holds only that language's files — the build pass itself still
 * walks every path it is handed once per language. That is not a polyglot tax
 * in practice: `scope-resolution/pipeline/run.ts:673` rebuilds `allFilePaths`
 * from the provider's own `parsedFiles`, so the set already contains only that
 * language's files.
 */
interface IndexedFile {
    readonly raw: string;
    /**
     * Position in `allFilePaths` iteration order. Still load-bearing:
     * `filesDirectlyInPkgDir` sorts on it to interleave several directories back
     * into the order the original single-pass scan emitted.
     */
    readonly ord: number;
}
/**
 * Deeply read-only on purpose. The memo hoist turned what used to be per-call
 * scratch into state shared by every import in a run, and `readonly` on the
 * PROPERTY still lets a caller do `idx.rootFiles.sort()` in place. Typing the
 * containers as read-only makes the copy-before-mutating rule compile-enforced
 * instead of comment-enforced — but `readonly` is erased at runtime and is not
 * hard to widen back (the sibling Kotlin index documents `Array.isArray`'s
 * `arg is any[]` predicate doing exactly that), so the one container callers
 * read directly is handed out through `sortedRootFiles` rather than raw.
 */
export interface PackageDirIndex {
    /** Last path segment of a directory → every normalized directory ending in it. */
    readonly dirsByLastSegment: ReadonlyMap<string, readonly string[]>;
    /** Normalized directory → the accepted files directly inside it, in Set order. */
    readonly filesByDir: ReadonlyMap<string, readonly IndexedFile[]>;
    /** Accepted files with no directory at all, in Set order. */
    readonly rootFiles: readonly string[];
}
/**
 * @param accept  Runs on the normalized (forward-slash) path; return `false` to
 *                leave the file out of the index entirely.
 */
export declare function buildPackageDirIndex(allFilePaths: ReadonlySet<string>, accept: (normalized: string) => boolean): PackageDirIndex;
/**
 * Every accepted file directly inside a directory ending with `pkgPath`, in
 * `allFilePaths` iteration order.
 */
export declare function filesDirectlyInPkgDir(index: PackageDirIndex, pkgPath: string): string[];
/** Root-package files in sorted order. Copies: the index array is shared by
 *  every import in the run and the result leaves as an edge target list. */
export declare function sortedRootFiles(index: PackageDirIndex): string[];
/**
 * The FIRST accepted file (in `allFilePaths` iteration order) directly inside a
 * directory ending with `pkgPath`, or `null`.
 */
export declare function firstFileDirectlyInPkgDir(index: PackageDirIndex, pkgPath: string): string | null;
export {};
