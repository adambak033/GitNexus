/**
 * PHP PSR-4 import resolution — internal helpers.
 *
 * Strategy lives in configs/php.ts.
 * This file contains the shared helper for PSR-4 resolution via composer.json.
 */
import type { SuffixIndex } from './utils.js';
import type { ComposerConfig } from '../language-config.js';
/**
 * Resolve a PHP use-statement import path using PSR-4 mappings (low-level helper).
 * e.g. "App\Http\Controllers\UserController" -> "app/Http/Controllers/UserController.php"
 *
 * For function/constant imports (use function App\Models\getUser), the last
 * segment is the symbol name, not a class name, so it may not map directly to
 * a file. When PSR-4 class-style resolution fails, we fall back to scanning
 * .php files in the namespace directory.
 *
 * NOTE: The function-import fallback returns the first matching .php file in the
 * namespace directory. When multiple files exist in the same namespace directory,
 * resolution is non-deterministic (depends on Set/index iteration order). This is
 * a known limitation — PHP function imports cannot be resolved to a specific file
 * without parsing all candidate files.
 */
export declare function resolvePhpImportInternal(importPath: string, composerConfig: ComposerConfig | null, allFiles: Set<string>, normalizedFileList: readonly string[], allFileList: readonly string[], index?: SuffixIndex): string | null;
