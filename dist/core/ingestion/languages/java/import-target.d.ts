/**
 * Adapter from `(ParsedImport, WorkspaceIndex)` → concrete file path.
 *
 * Converts Java package paths (dots → slashes) and tries:
 *   1. Exact file match: `com/example/User.java`
 *   2. Suffix match for nested layouts
 *   3. Directory match (wildcard imports)
 *   4. Progressive prefix stripping for non-standard layouts
 *
 * Returns `null` for unresolvable / JDK imports.
 *
 * ## Why the scans are gone (#2908)
 *
 * Every leg above used to be answered by `for (const raw of ctx.allFilePaths)`,
 * and the stripping loop ran that scan again per stripped segment — so one
 * unresolvable `import a.b.c.D;` (the COMMON case: JDK and third-party imports
 * run the whole cascade to completion) cost four full workspace passes. This is
 * byte-for-byte the shape C# carried until #2878; both now read the same two
 * per-file-set indexes, memoized on the Set's identity:
 *
 *   - `getWorkspaceFileIndex` — `normToRaw` (whole-path lookup) and `index`
 *     (segment-suffix lookup);
 *   - `getJavaDirIndex` — `firstFileDirectlyInPkgDir`'s package-directory index.
 *
 * ## The tie-breaks the scans encoded, and where they now live
 *
 *  1. The first pass `break`s on an exact whole-path hit but keeps scanning
 *     otherwise, then returns `exactFile ?? suffixFile ?? directoryChild`. So an
 *     exact match wins over a suffix or directory-child match found EARLIER in
 *     iteration order — hence `normToRaw` before `index`, which conflates the
 *     two (see `resolveDirectMatch`).
 *  2. The stripping loop instead `return`s mid-scan on `f === tailFile ||
 *     f.endsWith(tailSuffix)`, i.e. at the first hit of EITHER, and only returns
 *     its directory child after the scan completes. So file/suffix beats
 *     directory child within one `skip` level regardless of order, and the
 *     conflated `index.get` is the CORRECT lookup there (see
 *     `resolveByProgressiveStripping`).
 *  3. Wildcard imports drop their trailing `.*` before resolution, so
 *     `com.example.*` resolves as the package directory.
 *  4. `.java` filter and backslash normalization, with the RAW path returned:
 *     the indexes normalize for their keys and hand back the raw Set member, and
 *     only a `.java` file can carry a `…/<name>.java` suffix key, so the
 *     extension filter is implied on the file/suffix legs and explicit in the
 *     directory index's `accept`.
 *  5. The directory-child leg used to match on the FIRST `'/' + pathLike + '/'`
 *     occurrence, so `com/example/com/example/Deep.java` did NOT answer
 *     `com.example`. #2881 removed that: the rule came from how the pre-index
 *     scan was written, not from Java, and it made a package whose name repeats
 *     higher in the path unresolvable. `firstFileDirectlyInPkgDir` now answers
 *     plain "the parent directory ends with `pathLike`" (see the header of
 *     `import-resolvers/package-dir-index.ts`). This leg commits to ONE file
 *     with no downstream filter, so widening it can change which file an
 *     already-resolving import binds to, not only turn a null into a hit.
 *     WHICH file it binds to is decided by nothing in this resolver: it is
 *     `allFilePaths` iteration order, i.e. the insertion order of the Set built
 *     from `parsedFiles` in `scope-resolution/pipeline/run.ts`, which for a full
 *     scan is the canonical sorted path order `filesystem-walker.ts` imposes on
 *     its unsorted recursive-`glob` result. So the widened set's winner is a
 *     property of the file list, not of the import — pinned explicitly, in both
 *     insertion orders, by "pins WHICH of two competing package directories the
 *     first-child leg takes" in
 *     `test/unit/scope-resolution/java-import-target-parity.test.ts` (Kotlin's
 *     twin, which has the same unfiltered first-child leg, is in
 *     `test/unit/scope-resolution/kotlin/kotlin-import-target-parity.test.ts`).
 */
import type { ParsedImport, WorkspaceIndex } from '../../../../_shared/index.js';
export interface JavaResolveContext {
    readonly fromFile: string;
    readonly allFilePaths: ReadonlySet<string>;
}
export declare function resolveJavaImportTarget(parsedImport: ParsedImport, workspaceIndex: WorkspaceIndex): string | null;
