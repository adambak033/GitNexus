/**
 * Walk `repoPath` recursively and return relative paths of all `.h` files.
 * Used by `loadResolutionConfig` so the C resolver can resolve `#include`
 * targets that live in `.h` files (classified as C++ by language detection
 * but importable from `.c` files).
 */
export declare function scanHeaderFiles(repoPath: string): ReadonlySet<string>;
