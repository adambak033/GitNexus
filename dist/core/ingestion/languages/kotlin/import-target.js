import { KOTLIN_EXTENSIONS } from '../../import-resolvers/jvm.js';
import { perFileSet } from '../../import-resolvers/per-file-set.js';
export function resolveKotlinImportTarget(parsedImport, workspaceIndex) {
    const ctx = workspaceIndex;
    if (ctx === undefined ||
        typeof ctx.fromFile !== 'string' ||
        !(ctx.allFilePaths instanceof Set)) {
        return null;
    }
    if (parsedImport.kind === 'dynamic-unresolved')
        return null;
    if (parsedImport.targetRaw === null || parsedImport.targetRaw === '')
        return null;
    const target = parsedImport.targetRaw.endsWith('.*')
        ? parsedImport.targetRaw.slice(0, -2)
        : parsedImport.targetRaw;
    const pathLike = target.replace(/\./g, '/');
    // Resolution tiers, most-specific first:
    //  1. The full `pathLike` matches a `.kt`/`.kts` file directly
    //     (`import util.User` → `util/User.kt`).
    //  2. Stripped (last-segment removed) `pathLike` matches a file
    //     directly (`import util.OneArg.writeAudit` → `util/OneArg.kt`,
    //     a class-or-object holding `writeAudit`).
    //  3. Stripped `pathLike` matches a *package directory* — fan out to
    //     every `.kt`/`.kts` file inside it (`import models.getRepo` →
    //     `[models/User.kt, models/Repo.kt]`). The finalize pass walks
    //     each candidate and picks the one whose `localDefs` actually
    //     export the imported name (#1759).
    //  4. Progressive prefix strip for deeper namespace aliases that
    //     don't map 1:1 to directories.
    const index = getKotlinFileIndex(ctx.allFilePaths);
    const direct = findKotlinFile(index, pathLike);
    if (direct !== null)
        return direct;
    // Only tiers 2 and 3 need the stripped path, and tier 1 answers most
    // imports, so it is computed here rather than above. `lastIndexOf`/`slice`
    // rather than `split`/`slice`/`join`: same result for every input, two
    // allocations fewer per import. The `li < 0` guard is load-bearing —
    // `'a'.slice(0, -1)` is `''`, which is what the split form yields for a
    // single-segment path, but only by accident of `[].join('/')`.
    const li = pathLike.lastIndexOf('/');
    const stripped = li < 0 ? '' : pathLike.slice(0, li);
    return (findKotlinExactOrSuffix(index, stripped) ??
        findKotlinPackageFiles(index, stripped) ??
        findByProgressivePrefixStrip(index, pathLike));
}
function findKotlinFile(index, pathLike) {
    return findKotlinExactOrSuffix(index, pathLike) ?? findKotlinDirectoryChild(index, pathLike);
}
/** Exact (`file === pathLike+ext`) or suffix (`file ends with /pathLike+ext`)
 *  match — does NOT fall back to picking an arbitrary file inside a
 *  `pathLike/` directory. Used by the stripped-path tier in
 *  `resolveKotlinImportTarget` so a package import like `models.getRepo`
 *  delegates to `findKotlinPackageFiles` (multi-file fan-out) instead of
 *  silently committing to the first directory child.
 *
 *  An exact match anywhere in the workspace beats a suffix match anywhere,
 *  which is why the two are separate maps rather than one lookup: the old scan
 *  returned on the first exact hit but only remembered the first suffix hit,
 *  so an exact match found late still won. */
function findKotlinExactOrSuffix(index, pathLike) {
    if (pathLike === '')
        return null;
    return index.exactByStem.get(pathLike) ?? index.suffixByStem.get(pathLike) ?? null;
}
/** First directory child of `pathLike/` — preserves the legacy single-
 *  file fallback for cases where `pathLike` itself is an unqualified
 *  package reference (rare in real Kotlin code; some fixtures rely on
 *  it). Multi-file package fan-out goes through
 *  `findKotlinPackageFiles` instead. */
function findKotlinDirectoryChild(index, pathLike) {
    if (pathLike === '')
        return null;
    const children = index.dirChildren.get(pathLike);
    // "First" is first in `allFilePaths` iteration order, which the index
    // preserves by appending as it walks the set. Since #2881 that can be an
    // EARLIER file than the pre-index scan returned, never a later one: the
    // guards that fell take members away from no bucket, so a bucket only ever
    // gains, and a gained member lands wherever set iteration puts it.
    return children === undefined ? null : (children[0] ?? null);
}
/**
 * Return every `.kt`/`.kts` file inside the package directory `dirPath`
 * (e.g. `models` → `['models/User.kt', 'models/Repo.kt']`). Used as a
 * fallback when an import like `models.getRepo` does not resolve to a
 * file named after the symbol — in Kotlin the symbol can live in any
 * file inside the package directory. The finalize pass walks each
 * candidate and picks the one whose `localDefs` actually export the
 * imported name (#1759).
 */
function findKotlinPackageFiles(index, dirPath) {
    if (dirPath === '')
        return null;
    return index.dirChildren.get(dirPath) ?? null;
}
function findByProgressivePrefixStrip(index, pathLike) {
    const segments = pathLike.split('/').filter(Boolean);
    for (let skip = 1; skip < segments.length; skip++) {
        const found = findKotlinFile(index, segments.slice(skip).join('/'));
        if (found !== null)
            return found;
    }
    return null;
}
const getKotlinFileIndex = perFileSet((allFilePaths) => {
    // Runs on a cache miss only. That it happens once per run and not once per
    // import is asserted by counting traversals of the Set itself, in
    // `test/integration/kotlin-import-index-reuse.test.ts` (#2909).
    const exactByStem = new Map();
    const suffixByStem = new Map();
    const dirChildren = new Map();
    /**
     * BUILD-LOCAL: `dir` -> every `dirChildren` key a file in that directory
     * contributes to. That list is a pure function of `dir`, and a package
     * directory holds many files, so without this the walk below cuts one `slice`
     * per component of the SAME directory once per FILE — and every slice after
     * the first file's is a freshly allocated string that hashes to a key the map
     * already holds and is then dropped. Interning them once per DIRECTORY
     * instead of once per FILE is ~21% of the build at 32 000 files.
     *
     * It cannot move an answer. The array is filled on the first file of a
     * directory, in the order the per-file walk produced, and every later file in
     * that directory finds those keys already present — so the key set, the Map's
     * key insertion order and every bucket's order are what the per-file form
     * produced. `kotlin-index-internals.test.ts` pins the part of that a consumer
     * can observe, and does it through the resolver's own surface rather than over
     * the built maps: bucket CONTENTS and ORDER (from the fan-out tier, which
     * hands out the bucket array itself), bucket IDENTITY across calls, and that
     * the array handed out is FROZEN. Be precise about the limits, because the
     * mutation matrix in that file's header measured them: a MIS-KEYED memo is
     * caught, a DELETED one is not — the memo is output-identical by construction,
     * so nothing observable can prove it ran. Likewise `Object.isFrozen` catches a
     * missing freeze and a compacted-but-never-stored copy, but NOT a deleted
     * `slice()`: a JS array's backing-store capacity has no reflective surface, so
     * the compaction's only instrument is `heap_ceiling_bytes.kotlin` in
     * `bench/import-target/baselines.json` — a CEILING, because compaction
     * reclaims, so losing it makes the retained reading grow (+12.57% measured).
     * Map key insertion ORDER is
     * unasserted BY DESIGN:
     * `dirChildren` is only ever read by `.get(key)`, so key order has no
     * consumer and pinning it would assert an implementation detail nothing
     * depends on. Nothing else watches it either — the correctness fingerprint
     * sees this index only through the four tiers, so no fingerprint could catch
     * a key-order move.
     *
     * Dropped with this frame, so it costs nothing retained.
     */
    const dirKeys = new Map();
    for (const raw of allFilePaths) {
        const norm = raw.replace(/\\/g, '/');
        const ext = KOTLIN_EXTENSIONS.find((e) => norm.endsWith(e));
        // Kotlin resolution only ever queries `.kt`/`.kts` paths, exactly as the
        // scans did before skipping everything else first.
        if (ext === undefined)
            continue;
        const stem = norm.slice(0, norm.length - ext.length);
        if (!exactByStem.has(stem))
            exactByStem.set(stem, raw);
        // Component-suffixes of the stem: one per '/' in it. `a/b/User` yields
        // `b/User` and `User`, matching `norm.endsWith('/' + key + ext)`.
        for (let i = 0; i < stem.length; i++) {
            if (stem[i] !== '/')
                continue;
            const suffix = stem.slice(i + 1);
            if (!suffixByStem.has(suffix))
                suffixByStem.set(suffix, raw);
        }
        // From `stem`, not `norm`: an extension carries no '/', so the last '/' of
        // the two is the same character at the same index, and `stem.slice(0,
        // lastSlash)` IS the string `norm.slice(0, norm.lastIndexOf('/'))` was. One
        // backwards scan instead of two, over the string this loop already walked.
        const lastSlash = stem.lastIndexOf('/');
        if (lastSlash < 0)
            continue; // repo-root file has no package directory
        const dir = stem.slice(0, lastSlash);
        // The keys this file's directory contributes to, unguarded: `dir` itself,
        // plus every component-suffix of it. A suffix `s` starts just after a '/',
        // so `dir` ends with `/s` by construction and the file IS a direct child of
        // a directory named `s`. The absence of a narrowing guard is deliberate —
        // see the `dirChildren` section on `KotlinFileIndex` for the two guards
        // #2881 dropped and for what the resulting width costs downstream.
        let keys = dirKeys.get(dir);
        if (keys === undefined) {
            keys = [dir];
            for (let i = 0; i < lastSlash; i++) {
                if (dir[i] === '/')
                    keys.push(dir.slice(i + 1));
            }
            dirKeys.set(dir, keys);
        }
        for (const key of keys) {
            const bucket = dirChildren.get(key);
            if (bucket === undefined)
                dirChildren.set(key, [raw]);
            else
                bucket.push(raw);
        }
    }
    // Buckets are mutable only while this function runs; the index type hands
    // them out `readonly` and they are frozen here, before it is cached.
    // `findKotlinPackageFiles` hands a bucket straight out of the index — the
    // same array `findKotlinDirectoryChild` reads `children[0]` from — so a
    // downstream sort would permanently reorder the cached bucket and flip the
    // FIRST-child tier's answer for every later import in the run. The finalize
    // pass normalizes with `Array.isArray(t) ? t : [t]` and `isArray`'s
    // `arg is any[]` predicate widens the true branch; that one call site now
    // carries an explicit `readonly string[]` annotation, but the annotation is
    // one deletion away and covers only that site. Freezing makes the contract
    // true at runtime, so a future mutation is a loud TypeError, not a silent
    // edge move.
    //
    // COMPACTED as they are frozen: buckets grow by `push`, so V8's growth
    // overshoot stays retained for the life of the index. `length === 1` never
    // grew and is skipped — slicing it saves zero bytes and costs 31% of the
    // build on a corpus of single-file packages. The byte accounting lives once,
    // in `bench/import-target/baselines.json`.
    for (const [key, bucket] of dirChildren) {
        if (bucket.length === 1) {
            Object.freeze(bucket);
            continue;
        }
        const compacted = bucket.slice();
        Object.freeze(compacted);
        dirChildren.set(key, compacted);
    }
    return { exactByStem, suffixByStem, dirChildren };
});
