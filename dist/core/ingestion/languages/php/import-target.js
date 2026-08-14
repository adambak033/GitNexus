/**
 * Adapter from `(ParsedImport, WorkspaceIndex)` → concrete file path.
 *
 * Delegates to the existing `resolvePhpImportInternal` (PSR-4 via
 * composer.json + suffix matching fallback). The `WorkspaceIndex` is
 * opaque at this layer; consumers wire a `PhpResolveContext` shape
 * carrying `fromFile` + `allFilePaths`.
 *
 * `loadPhpComposerConfig` is the `ScopeResolver.loadResolutionConfig`
 * implementation — it loads `composer.json` once per workspace pass and
 * threads the parsed config into every subsequent `resolveImportTarget`
 * call via the opaque `resolutionConfig` parameter.
 *
 * Returning `null` lets the finalize algorithm mark the edge as
 * `linkStatus: 'unresolved'`.
 */
import { resolvePhpImportInternal } from '../../import-resolvers/php.js';
import { perFileSet } from '../../import-resolvers/per-file-set.js';
import { getWorkspaceFileIndex } from '../../import-resolvers/workspace-file-index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
function normalizePhpPath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
function namespaceDirectories(targetRaw, composerConfig, resolved) {
    const directories = new Set();
    if (resolved !== null) {
        const normalizedResolved = normalizePhpPath(resolved);
        const separator = normalizedResolved.lastIndexOf('/');
        if (separator >= 0)
            directories.add(normalizedResolved.slice(0, separator));
    }
    if (composerConfig === null)
        return [...directories];
    const normalizedTarget = normalizePhpPath(targetRaw);
    const mappings = [...composerConfig.psr4.entries()].sort((left, right) => {
        const lengthDifference = right[0].length - left[0].length;
        return lengthDifference !== 0 ? lengthDifference : left[0].localeCompare(right[0]);
    });
    for (const [namespacePrefix, directoryPrefix] of mappings) {
        const normalizedPrefix = normalizePhpPath(namespacePrefix);
        if (normalizedTarget !== normalizedPrefix &&
            !normalizedTarget.startsWith(`${normalizedPrefix}/`)) {
            continue;
        }
        const remainder = normalizedTarget.slice(normalizedPrefix.length).replace(/^\//, '');
        const separator = remainder.lastIndexOf('/');
        const relativeNamespace = separator >= 0 ? remainder.slice(0, separator) : '';
        directories.add(normalizePhpPath(relativeNamespace === '' ? directoryPrefix : `${directoryPrefix}/${relativeNamespace}`));
        break;
    }
    return [...directories];
}
function parentDirectory(filePath) {
    const normalizedPath = normalizePhpPath(filePath);
    const separator = normalizedPath.lastIndexOf('/');
    return separator < 0 ? '' : normalizedPath.slice(0, separator);
}
function directoryAliases(filePath) {
    const normalizedPath = normalizePhpPath(filePath);
    const separator = normalizedPath.lastIndexOf('/');
    if (separator < 0)
        return [''];
    const parent = normalizedPath.slice(0, separator);
    const aliases = new Set([parent]);
    const segments = parent.split('/').filter(Boolean);
    for (let index = 0; index < segments.length; index++) {
        aliases.add(segments.slice(index).join('/'));
    }
    return [...aliases];
}
/**
 * Directory alias → the files under it, built once per pass.
 *
 * A scope-resolution pass shares one stable `parsedFiles` array across imports,
 * so the array identity is the memo key — see `perFileSet`.
 */
const filesByDirectory = perFileSet((parsedFiles) => {
    const mutable = new Map();
    for (const parsed of parsedFiles) {
        for (const directory of directoryAliases(parsed.filePath)) {
            const files = mutable.get(directory) ?? [];
            files.push(parsed);
            mutable.set(directory, files);
        }
    }
    return mutable;
});
/** Memoized on the `allFilePaths` Set identity, like `getWorkspaceFileIndex`. */
const getPhpWorkspaceIndex = perFileSet((allFilePaths) => {
    // The Set is passed THROUGH to the shared cache, never copied — a defensive
    // `new Set(...)` here or in `scope-resolver.ts` would hand both WeakMaps a
    // fresh key per import and silently restore O(imports × files) (#1918 P1).
    const { normalized, all, index } = getWorkspaceFileIndex(allFilePaths);
    /**
     * Whole-path-lowercase → the first PROPER-suffix match, the correction `get`
     * applies to a whole-path hit from the shared index.
     *
     * DEFERRED, and deferred all the way to the branch that reads it rather than
     * to the first `get`. The builder walks every slash of every path and
     * lowercases a slice at each, so it is O(paths × depth) in both time and
     * allocation — measured 46.0 ms at 32 000 paths on the PHP arm of
     * `bench/import-target/`, filling a map that held ZERO entries, because it
     * can only hold one when some file's whole path is also a proper suffix of
     * another's. Most repos never produce that, and the ones that do reach this
     * branch only for the imports that actually hit a whole path. Pure function
     * of `normalized`/`all`, both of which the returned object already retains,
     * so building it late is behaviour-identical and retains nothing new.
     *
     * `wholePathLower` is a scratch set of the builder, not state: nothing reads
     * it afterwards, so deferring the map defers it too.
     */
    let firstProperSuffixMatch = null;
    const getFirstProperSuffixMatch = () => {
        if (firstProperSuffixMatch !== null)
            return firstProperSuffixMatch;
        const wholePathLower = new Set();
        for (const path of normalized)
            wholePathLower.add(path.toLowerCase());
        // Only the suffixes that a whole path can shadow are worth storing; see the
        // header. Built from `normalized`, so it costs no traversal of the Set.
        const built = new Map();
        for (let i = 0; i < normalized.length; i++) {
            const lower = normalized[i].toLowerCase();
            for (let slash = lower.indexOf('/'); slash >= 0; slash = lower.indexOf('/', slash + 1)) {
                const suffix = lower.slice(slash + 1);
                if (!wholePathLower.has(suffix))
                    continue;
                if (!built.has(suffix))
                    built.set(suffix, all[i]);
            }
        }
        firstProperSuffixMatch = built;
        return built;
    };
    /**
     * Raw directory → the files directly in it, for `getFilesInDir`.
     *
     * DEFERRED for the same reason as the shared `dirMap` (#2903), and here the
     * case is stronger: `getFilesInDir` has exactly one caller,
     * `import-resolvers/php.ts`'s PSR-4 function/constant fallback, and that
     * caller sits inside `if (composerConfig) { … }`. `resolvePhpImportTarget`
     * hard-codes `composerConfig: null`, so on the LanguageProvider path the map
     * is statically unreachable; on the ScopeResolver path it is reachable only
     * in a repo that has a parseable `composer.json` with `autoload.psr-4`.
     * Measured 6.8 ms / 3.56 MiB at 32 000 paths, paid by every PHP repo without
     * one. Pure function of `all`, which the returned object retains.
     */
    let filesByRawDirectory = null;
    const getFilesByRawDirectory = () => {
        if (filesByRawDirectory !== null)
            return filesByRawDirectory;
        // Raw paths, not normalized: the scan this replaces tests `f.startsWith(...)`
        // against the Set's own strings, so a backslash path is a miss there and must
        // stay a miss here. Insertion order is Set order, so `[0]` is the file the
        // scan would have returned first.
        const built = new Map();
        for (const raw of all) {
            const separator = raw.lastIndexOf('/');
            if (separator < 0)
                continue;
            const directory = raw.slice(0, separator);
            const bucket = built.get(directory);
            if (bucket === undefined)
                built.set(directory, [raw]);
            else
                bucket.push(raw);
        }
        filesByRawDirectory = built;
        return built;
    };
    const suffixIndex = {
        get: (suffix) => {
            const hit = index.getInsensitive(suffix);
            if (hit === undefined)
                return undefined;
            const lower = suffix.toLowerCase();
            // A proper-suffix hit is already the scan's answer: the shared map holds
            // the first file matching EITHER way, so nothing earlier matched at all.
            if (hit.replace(/\\/g, '/').toLowerCase() !== lower)
                return hit;
            // Whole-path hit — invisible to `endsWith('/' + S)`. The scan keeps going.
            // The only branch that needs the correction map, hence the only one that
            // builds it.
            return getFirstProperSuffixMatch().get(lower);
        },
        // Site 1 must stay a no-op, and `suffixResolve` folds this into `get`.
        getInsensitive: () => undefined,
        getFilesInDir: (dirSuffix, extension) => {
            // `nsDirPrefix` is `nsDir` when it already ends in `/`, else `nsDir + '/'`
            // — either way the directory is `nsDir` minus one trailing slash.
            const directory = dirSuffix.endsWith('/') ? dirSuffix.slice(0, -1) : dirSuffix;
            const bucket = getFilesByRawDirectory().get(directory);
            if (bucket === undefined)
                return [];
            return bucket.filter((file) => file.endsWith(extension));
        },
    };
    return { normalized, all, suffixIndex };
});
// ─── loadResolutionConfig ──────────────────────────────────────────────────
/**
 * Load and parse `composer.json` from the repo root. Returns a
 * `ComposerConfig` object (PSR-4 namespace → directory mappings) or
 * `null` when no `composer.json` is present or it cannot be parsed.
 *
 * The result is threaded into each `resolvePhpImportInternal` call as
 * the `composerConfig` argument.
 */
export function loadPhpComposerConfig(repoPath) {
    try {
        const composerPath = join(repoPath, 'composer.json');
        const raw = readFileSync(composerPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null)
            return null;
        const composer = parsed;
        const autoload = composer['autoload'];
        if (autoload === undefined)
            return null;
        const psr4Raw = (autoload['psr-4'] ?? {});
        const psr4 = new Map();
        for (const [ns, dirs] of Object.entries(psr4Raw)) {
            // namespace prefix ends with `\` — keep as-is; resolver strips it
            const normalizedNs = ns.replace(/\\$/, '');
            const dir = Array.isArray(dirs) ? dirs[0] : dirs;
            if (typeof dir === 'string') {
                // Normalize directory path (strip trailing slash)
                const normalizedDir = dir.replace(/\/+$/, '');
                psr4.set(normalizedNs, normalizedDir);
            }
        }
        return { psr4 };
    }
    catch {
        return null;
    }
}
// ─── resolvePhpImportTarget ────────────────────────────────────────────────
/**
 * LanguageProvider-shaped adapter: `(ParsedImport, WorkspaceIndex) → string | null`.
 *
 * The `WorkspaceIndex` is `unknown` in the shared contract. The scope-resolution
 * orchestrator hands us a `PhpResolveContext`-shaped object; narrow structurally
 * rather than via a cast chain so unexpected shapes return `null` cleanly.
 */
export function resolvePhpImportTarget(parsedImport, workspaceIndex) {
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
    // Cast, not copy: `getPhpWorkspaceIndex` memoizes on this exact Set object.
    const allFiles = ctx.allFilePaths;
    const { normalized, all, suffixIndex } = getPhpWorkspaceIndex(allFiles);
    return resolvePhpImportInternal(parsedImport.targetRaw, null, // composerConfig not available through LanguageProvider path
    allFiles, normalized, all, suffixIndex);
}
/**
 * ScopeResolver-shaped adapter: `(targetRaw, fromFile, allFilePaths, resolutionConfig?) → string | null`.
 *
 * Used inside `scope-resolver.ts`. Accepts the optional `resolutionConfig`
 * (a `ComposerConfig | null` loaded once per workspace by
 * `loadPhpComposerConfig`) and threads it into `resolvePhpImportInternal`.
 */
export function resolvePhpImportTargetInternal(targetRaw, _fromFile, allFilePaths, resolutionConfig, context) {
    if (targetRaw === '')
        return null;
    const composerConfig = resolutionConfig !== undefined && resolutionConfig !== null
        ? resolutionConfig
        : null;
    // Cast, not copy: `getPhpWorkspaceIndex` memoizes on this exact Set object.
    const allFiles = allFilePaths;
    const { normalized, all, suffixIndex } = getPhpWorkspaceIndex(allFiles);
    const resolved = resolvePhpImportInternal(targetRaw, composerConfig, allFiles, normalized, all, suffixIndex);
    const parsedImport = context?.parsedImport;
    const symbolKind = parsedImport?.kind === 'named' || parsedImport?.kind === 'alias'
        ? parsedImport.importedSymbolKind
        : undefined;
    if (context === undefined ||
        parsedImport === undefined ||
        (symbolKind !== 'function' && symbolKind !== 'const')) {
        return resolved;
    }
    const importedName = targetRaw.replace(/\\/g, '/').split('/').filter(Boolean).at(-1);
    if (importedName === undefined)
        return resolved;
    const directories = namespaceDirectories(targetRaw, composerConfig, resolved);
    const directoryIndex = filesByDirectory(context.parsedFiles);
    const candidateFiles = [
        ...new Set(directories.flatMap((directory) => {
            const files = directoryIndex.get(normalizePhpPath(directory)) ?? [];
            // A suffix alias can match directories under different roots (for
            // example app/Models and vendor/pkg/app/Models). Picking either root
            // would be a guess, so fail closed to the composer resolution instead.
            const distinctParents = new Set(files.map((file) => parentDirectory(file.filePath)));
            return distinctParents.size > 1 ? [] : files;
        })),
    ];
    const expectedType = symbolKind === 'function' ? 'Function' : 'Variable';
    const declaringFiles = candidateFiles.filter((parsed) => parsed.localDefs.some((def) => {
        if (def.type !== expectedType)
            return false;
        const simpleName = (def.qualifiedName ?? '').split(/[\\.]/).at(-1);
        return simpleName === importedName;
    }));
    if (declaringFiles.length > 1)
        return null;
    if (declaringFiles.length === 1)
        return declaringFiles[0].filePath;
    // PHP constants are not currently emitted as local definitions. A single
    // file in the namespace directory is still unambiguous; multiple files must
    // fail closed rather than inheriting Set iteration order.
    if (symbolKind === 'const' && candidateFiles.length === 1)
        return candidateFiles[0].filePath;
    return resolved;
}
