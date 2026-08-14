/**
 * PHP same-namespace cross-file visibility.
 *
 * In PHP, every class declared in `namespace Foo\Bar` is visible to all
 * other files in the same namespace WITHOUT an explicit `use` statement.
 * Without this pass, `Service.php` (namespace `App\Services`) can't see
 * `User` declared in `Models.php` (namespace `App\Models`) unless
 * `UserService.php` has an explicit `use App\Models\User` statement.
 *
 * More importantly, A.php (namespace `App\Models`) can return `Greeting`
 * (same namespace `App\Models`) without importing it, and the compound-
 * receiver resolver needs to find `Greeting` as a class binding in the
 * scope chain.
 *
 * Implementation mirrors C#'s `namespace-siblings.ts`:
 *   1. Extract the declared namespace from each PHP file's source.
 *   2. Group class-like defs by namespace.
 *   3. Inject sibling class defs into each file's Module scope's
 *      `bindingAugmentations` with `origin: 'namespace'`.
 *   4. Also mirror return-type bindings from same-namespace siblings
 *      so cross-file chain-follow finds return types without explicit imports.
 *
 * Uses the PHP tree-sitter parser (via the lazy singleton in `query.ts`)
 * to extract namespace declarations — same AST that `extractParsedFile`
 * already parsed, reused via `treeCache` to avoid double-parsing.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
interface PhpFileStructure {
    /** The declared namespace (backslash-separated), or '' for global namespace. */
    readonly namespace: string;
}
/**
 * Extract a PHP namespace declaration from raw source without tree-sitter.
 *
 * Single-pass line scanner that skips heredoc/nowdoc bodies, block
 * comments, and single-line comments before matching. This avoids the
 * false positives that a multiline regex produces when `namespace` appears
 * inside a heredoc, nowdoc, string, or comment.
 */
export declare function extractNamespaceViaScanner(content: string): string;
/**
 * Extract the declared namespace from a PHP file's source.
 * Uses the cached AST tree when available to avoid re-parsing.
 *
 * When no cached tree is available (worker-parsed files can't transfer
 * native Tree objects across MessageChannels), uses a line scanner
 * instead of re-parsing every file with tree-sitter. For 16K+ PHP files
 * this eliminates ~16K tree-sitter re-parses during the namespace-siblings
 * pass. See: https://github.com/abhigyanpatwari/GitNexus/issues/1741
 */
export declare function extractPhpFileStructure(content: string, cachedTree: unknown): PhpFileStructure;
export interface PhpSiblingInputs {
    readonly fileContents: ReadonlyMap<string, string>;
    readonly treeCache?: {
        get(filePath: string): unknown;
    };
}
/**
 * Read the cached PHP namespace for a given filePath. Returns `''` (global)
 * when the file has no namespace_definition or hasn't been processed yet.
 * Callers should only consult this AFTER either `populatePhpClassQualifiedNames`
 * or `populatePhpNamespaceSiblings` has run for the current resolution.
 */
export declare function getPhpNamespaceForFile(filePath: string): string;
/**
 * Inject same-namespace class defs and return-type bindings into each
 * PHP file's Module scope's `bindingAugmentations`. This makes classes
 * in the same PHP namespace visible to each other without explicit `use`
 * statements, mirroring PHP's actual runtime behavior.
 *
 * Uses `origin: 'namespace'` so `phpMergeBindings` tiers it below
 * explicit `use` imports (`origin: 'import'`) and local declarations.
 */
export declare function populatePhpNamespaceSiblings(parsedFiles: readonly ParsedFile[], indexes: ScopeResolutionIndexes, inputs: PhpSiblingInputs): void;
export {};
