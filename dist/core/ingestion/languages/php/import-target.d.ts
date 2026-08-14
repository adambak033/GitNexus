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
import type { ParsedImport, WorkspaceIndex } from '../../../../_shared/index.js';
import type { ImportResolutionContext } from '../../scope-resolution/contract/scope-resolver.js';
import type { ComposerConfig } from '../../language-config.js';
export interface PhpResolveContext {
    readonly fromFile: string;
    readonly allFilePaths: ReadonlySet<string>;
}
/**
 * Load and parse `composer.json` from the repo root. Returns a
 * `ComposerConfig` object (PSR-4 namespace → directory mappings) or
 * `null` when no `composer.json` is present or it cannot be parsed.
 *
 * The result is threaded into each `resolvePhpImportInternal` call as
 * the `composerConfig` argument.
 */
export declare function loadPhpComposerConfig(repoPath: string): ComposerConfig | null;
/**
 * LanguageProvider-shaped adapter: `(ParsedImport, WorkspaceIndex) → string | null`.
 *
 * The `WorkspaceIndex` is `unknown` in the shared contract. The scope-resolution
 * orchestrator hands us a `PhpResolveContext`-shaped object; narrow structurally
 * rather than via a cast chain so unexpected shapes return `null` cleanly.
 */
export declare function resolvePhpImportTarget(parsedImport: ParsedImport, workspaceIndex: WorkspaceIndex): string | null;
/**
 * ScopeResolver-shaped adapter: `(targetRaw, fromFile, allFilePaths, resolutionConfig?) → string | null`.
 *
 * Used inside `scope-resolver.ts`. Accepts the optional `resolutionConfig`
 * (a `ComposerConfig | null` loaded once per workspace by
 * `loadPhpComposerConfig`) and threads it into `resolvePhpImportInternal`.
 */
export declare function resolvePhpImportTargetInternal(targetRaw: string, _fromFile: string, allFilePaths: ReadonlySet<string>, resolutionConfig?: unknown, context?: ImportResolutionContext): string | null;
