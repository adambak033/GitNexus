/**
 * Go package import resolution — internal helpers.
 *
 * Strategy lives in configs/go.ts.
 * This file contains the shared helpers used by the strategy.
 *
 * **Reachability, as of #2929:** nothing in production calls either export
 * today. The only path in is `configs/go.ts` → `createImportResolver` →
 * the `importResolver` field on Go's `LanguageProvider`, and that field is
 * read at exactly two lines — `import-target-adapter.ts:74-75` — whose two
 * exports (`buildImportTargetWorkspace`,
 * `resolveImportTargetAcrossLanguages`) have no importer anywhere but their
 * own unit test. So this is a live-looking but currently unwired leg; the
 * tests in `test/unit/import-resolvers/go-package-resolve.test.ts` are the
 * only thing watching it.
 */
import type { GoModuleConfig } from '../language-config.js';
/**
 * Extract the package directory suffix from a Go import path.
 * Returns the suffix string (e.g., "/internal/auth/") or null if invalid.
 */
export declare function resolveGoPackageDir(importPath: string, goModule: GoModuleConfig): string | null;
/**
 * Resolve a Go internal package import to all .go files in the package directory.
 * Returns an array of file paths.
 */
export declare function resolveGoPackage(importPath: string, goModule: GoModuleConfig, normalizedFileList: readonly string[], allFileList: readonly string[]): string[];
