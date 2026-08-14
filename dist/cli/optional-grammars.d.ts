/**
 * Optional grammar availability check.
 *
 * tree-sitter-dart, -proto, -swift, and -kotlin are vendored under vendor/ and
 * loaded from there by absolute path (NEVER copied into node_modules — see
 * core/tree-sitter/vendored-grammars.ts / #2111). Each ships committed platform
 * prebuilds activated via node-gyp-build. All can be skipped via
 * GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 (postinstall scripts), or can silently
 * soft-fail when no prebuild matches the host platform (and a source build was
 * unavailable / not attempted).
 *
 * Either path produces the same observable: the .node binding is absent
 * at runtime. This helper detects that condition and surfaces a single
 * stderr line per missing grammar so users learn why .dart/.proto/.swift/.kt
 * support is unavailable instead of silently getting a degraded index.
 */
/**
 * The file extensions backed by an optional grammar — the single source for
 * the `analyze` preflight glob (so the glob can't drift from this list).
 */
export declare function getOptionalGrammarExtensions(): string[];
export interface MissingGrammar {
    name: string;
    extensions: string[];
    /**
     * `missing` — the native binding could not be loaded (not installed / build
     * soft-failed / no prebuild). `skipped` — the binding is fine but the user
     * disabled it via `GITNEXUS_SKIP_OPTIONAL_GRAMMARS`. Drives the warning text
     * so a deliberate opt-out is not told to reinstall.
     */
    reason: 'missing' | 'skipped';
}
/**
 * Returns the list of optional grammars whose native binding cannot be
 * loaded. Actually `require()`s the package — `require.resolve` would
 * locate the entry path even when the `.node` binding is absent (the
 * package directory exists without a working `.node` binding), giving false
 * negatives for the exact users we want to warn:
 * those who installed with `GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1` or whose
 * native rebuild soft-failed for missing toolchain.
 *
 * Node's module cache memoizes `require()` for us — calling this multiple
 * times is cheap. The catch distinguishes "missing" (MODULE_NOT_FOUND or
 * the typical node-gyp-build "could not find any binding" pattern) from
 * "broken" (SyntaxError, EACCES, native crash). Broken bindings surface a
 * separate stderr line so users get an actionable message instead of a
 * misleading "reinstall" hint.
 */
export declare function detectMissingOptionalGrammars(): MissingGrammar[];
/**
 * Log a one-line stderr warning for each missing grammar. Safe to call
 * unconditionally — silent if all grammars are present.
 *
 * `relevantExtensions`, if provided, filters the warning to grammars whose
 * extensions appear in the set (e.g. an analyze run can pass the set of
 * extensions actually present in the target repo so users without any
 * .dart/.proto files don't see noise).
 */
export declare function warnMissingOptionalGrammars(opts?: {
    context?: string;
    relevantExtensions?: ReadonlySet<string>;
}): void;
