/**
 * Swift import resolution config.
 * Package.swift target map strategy — no standard fallback (unresolved = external framework).
 *
 * ## Performance (anti-O(imports × files))
 *
 * The previous implementation rescanned the whole `normalizedFileList`
 * on every import to collect the `.swift` files under the requested
 * target's directory — O(imports × files) per run, the exact hot path
 * fixed for Python in PR #1918. We now build a `target → files` index
 * ONCE per run, memoized on the stable `allFileList` array reference
 * (the same `ResolveCtx` — and therefore the same array — is passed to
 * every strategy invocation, per `import-processor`'s build-once
 * context). Lookup per import is then O(1).
 *
 * Behavior is preserved bit-for-bit: a file is attributed to a target
 * iff its **forward-slash (backslash-normalized), case-sensitive** path
 * starts with `<targetDir>/`, matching the old
 * `normalizedFileList[i].startsWith(targetDir + '/')` comparison
 * (`normalizedFileList` is only backslash→forward-slash normalized — NOT
 * lowercased — so the match is case-sensitive); the returned paths are
 * the original-case `allFileList` entries; and the per-target file ORDER
 * follows `allFileList`, so the emitted `{ kind: 'files', files }` set and
 * ordering are identical to the old scan.
 */
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
/** Swift Package.swift target map resolution strategy. */
export declare const swiftPackageStrategy: ImportResolverStrategy;
export declare const swiftImportConfig: ImportResolutionConfig;
