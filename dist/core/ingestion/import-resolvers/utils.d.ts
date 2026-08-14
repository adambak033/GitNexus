/**
 * Suffix-index helpers for import path resolution.
 */
/** All file extensions to try during resolution */
export declare const EXTENSIONS: string[];
/**
 * Try to match a path (with extensions) against the known file set.
 * Returns the matched file path or null.
 */
export declare function tryResolveWithExtensions(basePath: string, allFiles: ReadonlySet<string>): string | null;
/**
 * Build a suffix index for O(1) endsWith lookups.
 * Maps every possible path suffix to its original file path.
 * e.g. for "src/com/example/Foo.java":
 *   "Foo.java" -> "src/com/example/Foo.java"
 *   "example/Foo.java" -> "src/com/example/Foo.java"
 *   "com/example/Foo.java" -> "src/com/example/Foo.java"
 *   etc.
 */
export interface SuffixIndex {
    /**
     * Exact suffix lookup (case-sensitive).
     *
     * The map behind this is built on the FIRST call and memoized — see
     * `buildSuffixIndex`. All three maps are deferred; a consumer pays only for
     * the questions it actually asks.
     */
    get(suffix: string): string | undefined;
    /**
     * Case-insensitive suffix lookup.
     *
     * Deferred like `get`, and — when `get` was asked first — DERIVED from that
     * map rather than traversed for a second time. See `buildSuffixIndex`.
     */
    getInsensitive(suffix: string): string | undefined;
    /**
     * Get all files in a directory suffix.
     *
     * `dirSuffix` is matched as a SEGMENT-aligned directory suffix — every
     * returned file is a direct child of a directory `D` with
     * `D === dirSuffix || D.endsWith('/' + dirSuffix)`. Callers may rely on this
     * and skip a direct-child re-check; `import-resolvers/csharp.ts` step 2 does
     * exactly that. It bounds what may be RETURNED, not what must be found: an
     * implementation is free to answer with fewer files, and the root-anchored
     * index in `languages/php/import-target.ts` answers only the `D === dirSuffix`
     * arm.
     *
     * `readonly` is the CONTRACT, and it is the contract for every implementation
     * of this interface, not a description of any one of them: an implementation
     * is free to return its own bucket by reference, so callers must treat the
     * result as shared and never `sort`/`splice` it in place. The compiler now
     * refuses that at the call site. Whether a given implementation shares or
     * copies is its own business and documented where it is built —
     * `buildSuffixIndex` shares, the root-anchored parity index in
     * `languages/php/import-target.ts` returns a filtered copy.
     *
     * Implementations that memoize should note the directory map behind this may
     * be built on the FIRST call rather than up front, so a caller that never
     * asks a directory question never pays for it — see `buildSuffixIndex`.
     */
    getFilesInDir(dirSuffix: string, extension: string): readonly string[];
}
export interface SuffixIndexOptions {
    /**
     * Promise from the caller that `normalizedFileList[i] === normalizedFileList[i].toLowerCase()`
     * for every `i` — i.e. the "normalized" list is a LOWERCASED file list, not
     * merely a slash-normalized one.
     *
     * `import-resolvers/pass-cache.ts` is the one caller that can make it: it
     * builds `normalizedFileList` as `allFileList.map((f) => f.toLowerCase())`.
     * Every suffix of an all-lowercase path is itself lowercase, so
     * `suffix.toLowerCase() === suffix` and the case-folded map came out a
     * byte-identical copy of the exact one — same keys, same values, same
     * insertion order. Measured 14.00 MiB at 32 000 paths, 29.8% of the retained
     * `ImportPassCache` — and one `ImportPassCache` is built per ts-family
     * adapter per pass, so the waste was carried once for each of them.
     *
     * With this set, `getInsensitive` reads the exact map directly instead. It is
     * the same map the derivation below would have produced, so this is a skipped
     * copy and not a second lookup rule — see `getLowerMap`.
     *
     * Setting it over a list that is NOT all-lowercase is a behaviour change, not
     * an optimization: `getInsensitive` would then answer case-sensitively.
     */
    readonly alreadyLowercased?: boolean;
}
export declare function buildSuffixIndex(normalizedFileList: readonly string[], allFileList: readonly string[], options?: SuffixIndexOptions): SuffixIndex;
/**
 * Suffix-based resolution using index. O(1) per lookup instead of O(files).
 */
export declare function suffixResolve(pathParts: string[], normalizedFileList: readonly string[], allFileList: readonly string[], index?: SuffixIndex): string | null;
