import type { ParsedFile, ScopeId } from '../../../../_shared/index.js';
interface RangeKeyShape {
    readonly startLine: number;
    readonly startCol: number;
    readonly endLine: number;
    readonly endCol: number;
}
/** Record a symbol name as file-local (static or anonymous namespace). */
export declare function markFileLocal(filePath: string, name: string): void;
/** Check whether a symbol name has file-local linkage in the given file. */
export declare function isFileLocal(filePath: string, name: string): boolean;
/** Capture-time: record an anonymous `namespace_definition` source range. */
export declare function markCppAnonymousNamespaceRange(filePath: string, range: RangeKeyShape): void;
/** Predicate consumed by `populateCppNonGloballyVisible` and
 *  `expandCppWildcardNames` to exempt anonymous-namespace scopes from
 *  the cross-file unqualified-lookup exclusion that applies to ordinary
 *  named namespaces. */
export declare function isCppAnonymousNamespaceScope(scopeId: ScopeId): boolean;
/**
 * Plain-data, JSON-serializable snapshot of the per-file capture-time
 * file-local-linkage state. Carried on `ParsedFile.captureSideChannel` across
 * the worker→main boundary (#1983). The derived sets (`nonGloballyVisibleNodeIds`,
 * `anonymousNamespaceScopeIds`) are recomputed by `populateCppNonGloballyVisible`
 * / `populateCppAnonymousNamespaceScopes` during `populateOwners`, so only the
 * two capture-time maps cross the boundary.
 */
export interface CppFileLocalSideChannel {
    /** File-local symbol names (static / anonymous-namespace) in this file. */
    readonly fileLocalNames: readonly string[];
    /** Anonymous-namespace source-range keys recorded for this file. */
    readonly anonymousNamespaceRanges: readonly string[];
}
/** Snapshot this file's file-local-linkage capture state for the side-channel. */
export declare function collectCppFileLocalSideChannel(filePath: string): CppFileLocalSideChannel;
/** Restore this file's file-local-linkage capture state from the side-channel. */
export declare function applyCppFileLocalSideChannel(filePath: string, data: CppFileLocalSideChannel): void;
/** Clear tracked file-local names (call at start of each resolution pass). */
export declare function clearFileLocalNames(): void;
/** Resolve recorded anonymous-namespace source ranges to `ScopeId`s.
 *  Must run inside `populateOwners` BEFORE `populateCppNonGloballyVisible`
 *  consults the resolved set. */
export declare function populateCppAnonymousNamespaceScopes(parsed: {
    readonly filePath: string;
    readonly scopes: readonly {
        readonly id: ScopeId;
        readonly kind: string;
        readonly range: RangeKeyShape;
    }[];
}): void;
/**
 * Populate per-file "not globally visible" nodeIds by walking the parsed
 * file's scopes. Run as part of the `populateOwners` hook so every C++
 * scope is reflected before any cross-file resolution pass consults the
 * set.
 *
 * A def is "not globally visible" when its nearest structurally enclosing
 * scope is a `Namespace` or `Class` — those require qualification
 * (`ns::name`, `Class::method`) for cross-file unqualified lookup.
 * Module-scoped defs remain globally visible.
 */
export declare function populateCppNonGloballyVisible(parsed: {
    readonly filePath: string;
    readonly scopes: readonly {
        readonly id: ScopeId;
        readonly kind: string;
        readonly ownedDefs: readonly {
            readonly nodeId: string;
        }[];
    }[];
}): void;
/**
 * Check whether a def is visible by unqualified lookup from outside its
 * own file. Returns `false` for class-owned and namespace-nested defs.
 *
 * Used by the global free-call fallback's `isFileLocalDef` hook (which
 * historically meant "static / anonymous-namespace" but semantically
 * stands for "logically invisible cross-file"). Including class methods
 * and namespace members under the same negative answer fixes the leak
 * where unqualified `save()` resolved to `User::save` through a shared
 * workspace registry walk.
 */
export declare function isCppDefGloballyVisible(filePath: string, nodeId: string): boolean;
export declare function expandCppWildcardNames(targetModuleScope: ScopeId, parsedFiles: readonly ParsedFile[]): readonly string[];
export {};
