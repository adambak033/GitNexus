/**
 * Rust module import resolution — internal helpers.
 *
 * Strategy lives in configs/rust.ts.
 * This file contains shared helpers used by the strategy and standard.ts.
 */
/**
 * Resolve Rust use-path to a file (low-level helper).
 * Handles crate::, super::, self:: prefixes and :: path separators.
 */
export declare function resolveRustImportInternal(currentFile: string, importPath: string, allFiles: ReadonlySet<string>): string | null;
/**
 * Try to resolve a Rust module path to a file.
 * Tries: path.rs, path/mod.rs, and with the last segment stripped
 * (last segment might be a symbol name, not a module).
 */
export declare function tryRustModulePath(modulePath: string, allFiles: ReadonlySet<string>): string | null;
