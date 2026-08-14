import type { ParsedFile, ScopeId } from '../../../../_shared/index.js';
/** Record a symbol name as `static` (file-local linkage) for the given file. */
export declare function markStaticName(filePath: string, name: string): void;
/** Check whether a symbol name has `static` linkage in the given file. */
export declare function isStaticName(filePath: string, name: string): boolean;
/**
 * Return the `static` (file-local) names recorded for the given file as a
 * plain array (empty when none). Used to snapshot the per-file slice of the
 * module-level `staticNames` map into `ParsedFile.captureSideChannel` so it
 * survives the worker→main boundary (#1983 — the worker is the sole parse
 * path). See `c/capture-side-channel.ts`.
 */
export declare function getStaticNamesForFile(filePath: string): string[];
/** Clear tracked static names (for testing). */
export declare function clearStaticNames(): void;
/**
 * Return the names visible through a C wildcard import (`#include`).
 * All module-scope defs from the target file are visible EXCEPT those
 * declared with `static` storage class (file-local linkage in C).
 */
export declare function expandCWildcardNames(targetModuleScope: ScopeId, parsedFiles: readonly ParsedFile[]): readonly string[];
