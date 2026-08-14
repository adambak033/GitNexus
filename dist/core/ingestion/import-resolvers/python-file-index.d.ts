/**
 * The one per-file-set index behind Python import resolution, plus the two
 * importer-chain memos that ride inside it.
 *
 * ## Why this is its own module
 *
 * Everything here is derived from `allFilePaths` and nothing here is specific
 * to either CALLER, and there are two of them on opposite sides of a layer
 * boundary: `import-resolvers/python.ts` resolves the single-segment bare tier
 * and `languages/python/import-target.ts` resolves the dotted tiers. The second
 * imports the first, so the index could not live in either without the other
 * reaching back through a cycle — it used to live in `import-target.ts`, which
 * is why the bare tier had no O(1) proof of absence and probed the whole
 * ancestor chain for every `import os`.
 *
 * The shape is the one `workspace-file-index.ts` and `package-dir-index.ts`
 * already use in this directory: an interface, one `perFileSet` builder, and
 * query functions taking the index.
 */
/**
 * The importer's ancestor directories, CLOSEST FIRST and excluding the
 * workspace root — `["backend/routers", "backend"]` for `backend/routers/x.py`
 * — memoized per importer DIRECTORY for the lifetime of the pass.
 *
 * This is the #2913 fix. Both consumers used to rebuild the chain inline, one
 * `dirParts.slice(0, i).join('/')` per component, on EVERY import: a per-import
 * cost proportional to the importer's path depth, and quadratic in characters,
 * on a file index that is itself depth-free. Real Python layouts are deep
 * (`src/pkg/sub/feature/impl/mod.py` is ordinary), so the resolver was 6.8x
 * slower on a deep corpus than on a shallow one holding the file count fixed,
 * where every other language sat between 1.0x and 3.4x.
 *
 * A directory's ancestors are a pure function of the directory, and a pass
 * resolves many imports per file, so one entry serves every import issued from
 * anywhere in that directory.
 *
 * ## Lifetime and memory
 *
 * The Map lives INSIDE the per-file-set index, so it is reclaimed with the file
 * set it was reached through (`perFileSet` is a `WeakMap`): it cannot leak
 * across passes or repos, and there is no invalidation rule to get wrong. It is
 * filled lazily, so it holds one entry per directory that actually ISSUES a
 * Python import, never one per file and never one per directory in the repo —
 * the bound #2649 (kernel-scale OOM) asks for. Each entry's strings are
 * `slice`s of the longest one, so a chain costs pointers rather than a copy of
 * the path per component.
 *
 * The derived key is the importer's directory exactly as the old inline code
 * computed it — `norm.split('/').slice(0, -1).join('/')`, which for a path
 * without a separator is `''` (a root-level importer, whose chain is empty).
 */
/**
 * The importer's own directory, normalized — the key BOTH per-directory memos
 * below are stored under.
 *
 * One exported derivation rather than one per accessor: the two memos live in
 * the same index and must agree on what "the importer's directory" is, and a
 * caller that already holds the directory (the bare-import tier computes it for
 * its own proximity check) should not pay for it twice. It was three copies of
 * `replace / lastIndexOf / slice` across two modules before, byte-identical by
 * inspection and by nothing else.
 */
export declare function importerDirOf(fromFile: string): string;
export declare function importerAncestors(index: PythonFileIndex, importerDir: string): readonly string[];
/**
 * Per-file-set index for Python import resolution, memoized on the
 * `allFilePaths` Set object (the same Set is passed for every import in a run,
 * so the index is built once and reused). Replaces the per-import O(files)
 * scans in `resolveAbsoluteFromFiles` (suffix match) and `hasRepoCandidate`
 * (package-existence gate) with O(1)/O(bucket) lookups.
 *
 *  - `normSet`: every file path, normalized to forward slashes (for the exact
 *    `f === rootFile|initFile` membership checks). It IS derivable from the two
 *    buckets below — both probes could be a `.some(c => c.norm === …)` over
 *    `byBasename.get(rootFile)` / `byInitParent.get(initFile)` — and it is kept
 *    anyway, deliberately. `byBasename` is keyed on the BASENAME, so its bucket
 *    for a common Python file name is not small and grows with the repo: on a
 *    9 000-file service tree, `utils.py`, `models.py` and `views.py` hold 1 000
 *    entries each. `import utils` would then scan every `utils.py` in the
 *    workspace on every import — a per-import cost proportional to corpus size,
 *    which is the exact defect class #2901/#2902/#2908 removed. The Set trades
 *    ~1.6 MB at 32 000 files, against a 6.4 MB reading, to keep both probes
 *    O(1). Do not "simplify" it away without re-measuring that bucket.
 *  - `byBasename`: last path component (e.g. `models.py`, `__init__.py`) ->
 *    all `{ raw, norm }` candidates, so suffix matches can be gathered from the
 *    relevant bucket and the exact tie-break applied across ALL of them.
 *  - `byInitParent`: `__init__.py` files keyed by their last TWO components
 *    (`<parentDir>/__init__.py`). The package suffix lookup (`pkg.sub` ->
 *    `…/sub/__init__.py`) targets only same-named package dirs via this map
 *    instead of scanning every `__init__.py` in the repo — the common
 *    multi-segment import path no longer scales with package count
 *    (PR #1918 review P2b). `__init__.py` files stay in `byBasename` too, for
 *    the rarer explicit `pkg.__init__` import that resolves via the module
 *    (`…<lastSeg>.py`) lookup.
 *  - `dirPrefixes`: every directory prefix of a `.py` file, trailing-slashed
 *    (`a/b/c.py` -> `a/`, `a/b/`), for "is there a .py file under `<dir>/`".
 *  - `nestedDirNames`: the NAME of every such directory that has a non-empty
 *    parent (`a/b/c.py` -> `b`, not `a`), which is exactly the set of segments
 *    `hasRepoCandidate`'s ancestor walk can ever match — so a segment absent
 *    from it settles the walk in one lookup (#2913).
 *  - `ancestorsByDir`: the per-importer-directory ancestor-chain memo behind
 *    `importerAncestors`. The one structure here that is NOT derived from the
 *    file set: it is filled lazily, from the importer paths the pass actually
 *    resolves against, and lives here so it dies with the pass.
 *  - `bareImportPrefixesByDir`: the same idea for the OTHER chain — the
 *    sys.path-style prefixes `resolvePythonImportInternal`'s single-segment
 *    walk probes. A different sequence, not a different spelling: see
 *    `importerBarePrefixes`. Two memos in one index rather than two indexes,
 *    because they are keyed on the same thing and must die together.
 *
 * Exported for `test/unit/scope-resolution/python/python-importer-ancestors.test.ts`
 * and `test/unit/import-resolvers/python-importer-prefixes.test.ts`, which read
 * the two memos after driving the production adapters. No counter ships for
 * either — the Map IS the memo, and its SIZE is the assertion: one entry per
 * importer directory, however many imports were resolved. Everything else about
 * the index stays internal.
 */
export interface PythonFileIndex {
    readonly normSet: Set<string>;
    readonly byBasename: Map<string, {
        raw: string;
        norm: string;
    }[]>;
    readonly byInitParent: Map<string, {
        raw: string;
        norm: string;
    }[]>;
    readonly dirPrefixes: Set<string>;
    readonly nestedDirNames: Set<string>;
    readonly ancestorsByDir: Map<string, readonly string[]>;
    readonly bareImportPrefixesByDir: Map<string, readonly string[]>;
}
export declare const getPythonFileIndex: (key: ReadonlySet<string>) => PythonFileIndex;
/**
 * The sys.path-style prefixes `resolvePythonImportInternal`'s single-segment
 * bare-import walk probes, in order, for an importer sitting in `importerDir` —
 * memoized per DIRECTORY for the lifetime of the pass, in the same index and
 * for the same reasons as `importerAncestors`.
 *
 * ## Why this is not `ancestorsByDir`
 *
 * A DIFFERENT SEQUENCE, not a different spelling. For `backend/routers/cron.py`:
 *
 *   importerAncestors      ["backend/routers", "backend"]
 *   importerBarePrefixes   ["backend/", ""]
 *
 * Three differences, each load-bearing:
 *
 *  1. `importerAncestors` opens with the importer's OWN directory; this walk
 *     does not, because its proximity check has already probed that directory.
 *  2. This walk ENDS at the workspace root (`""`, which probes `<module>.py`
 *     unprefixed); `importerAncestors` stops short of it, because
 *     `resolveAbsoluteFromFiles` probes the root before its walk instead.
 *  3. `importerAncestors` drops empty components (`filter(Boolean)`); this walk
 *     keeps them, and the difference decides real resolutions — for
 *     `/abs/a/b/mod.py` this walk probes `/abs/a/`, `/abs/`, `""`, `""` where a
 *     filtered chain would probe `abs/a/b/`, `abs/a/`, `abs/`, none of which is
 *     a prefix of any file in an absolute-path workspace.
 *
 * So the two cannot share one chain without changing which files resolve. They
 * do share the index, the key and the lifetime, which is what actually matters
 * for #2649: both are filled lazily, hold one entry per directory that ISSUES
 * an import, and die with the pass because the index does.
 */
export declare function importerBarePrefixes(index: PythonFileIndex, importerDir: string): readonly string[];
/**
 * "No file anywhere in the workspace can be `<X>/<segment>.py` or
 * `<X>/<segment>/__init__.py`, for ANY prefix `<X>`" — in two Map lookups.
 *
 * This is a PROOF OF ABSENCE, not a heuristic filter, and it is what lets the
 * single-segment bare walk skip itself entirely. Both shapes it rules out are
 * the only two shapes that walk probes: a probe `${prefix}${segment}.py` that
 * is a member of the file set is a path with no backslash (the prefix comes
 * from a normalized importer and the guard below rejects a segment carrying
 * one), so it equals its own normalized form and its basename is exactly
 * `${segment}.py` — which puts it in `byBasename`. A probe
 * `${prefix}${segment}/__init__.py` that is a member likewise has parent
 * directory name exactly `segment`, non-empty, which puts it in `byInitParent`
 * whether or not `prefix` is empty. So a miss in both buckets means every probe
 * the walk would issue is guaranteed to miss.
 *
 * Two inputs cannot be proven absent and get `false` — walk as before:
 *
 *  - the EMPTY segment (a target spelled with a trailing dot).
 *    `byInitParent` skips `__init__.py` files whose parent directory name is
 *    empty, so its absence proves nothing. Same carve-out
 *    `resolveAbsoluteFromFiles` makes for `lastSeg === ''`.
 *  - a segment containing a BACKSLASH. The buckets are keyed on normalized
 *    paths, so a raw `a\b.py` is filed under basename `b.py`; a probe for the
 *    segment `a\b` would look up `a\b.py`, miss, and wrongly conclude absence
 *    while `allFilePaths.has('a\\b.py')` is true. Not reachable from a Python
 *    import statement, but this function is a proof and a proof has no
 *    unstated preconditions.
 *
 * The dotted tier in `languages/python/import-target.ts` asks the same question
 * of the same two buckets and is deliberately NOT routed through here: it needs
 * the candidate ARRAYS for its suffix fallback, so it does the two `get`s it
 * already needs and derives the answer, rather than paying two extra `has`
 * lookups per import to share four lines.
 */
export declare function pythonSegmentAbsent(index: PythonFileIndex, segment: string): boolean;
