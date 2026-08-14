/**
 * Walk `repoPath` recursively and return relative paths of all C++ header files.
 * Used by `loadResolutionConfig` so the C++ resolver can resolve `#include`
 * targets that live in header files.
 *
 * Scans for: .h, .hpp, .hxx, .hh, .cuh
 */
export declare function scanCppHeaderFiles(repoPath: string): ReadonlySet<string>;
