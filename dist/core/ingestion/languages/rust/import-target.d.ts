/**
 * Resolve a Rust `use` import path to a repo-relative file path.
 *
 * Rust module resolution rules:
 *   - `crate::foo::bar` → `src/foo/bar.rs` or `src/foo/bar/mod.rs`
 *   - `super::foo` → parent directory's `foo.rs` or `foo/mod.rs`
 *   - `self::foo` → same directory's `foo.rs` or `foo/mod.rs`
 *   - External crate imports (no `crate::`/`super::`/`self::`) → null
 */
export declare function resolveRustImportTarget(targetRaw: string, fromFile: string, allFilePaths: ReadonlySet<string>, _resolutionConfig?: unknown): string | readonly string[] | null;
export interface RustResolveContext {
    readonly fromFile: string;
    readonly allFilePaths: ReadonlySet<string>;
}
