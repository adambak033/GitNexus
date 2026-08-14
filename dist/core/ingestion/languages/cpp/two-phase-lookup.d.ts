/**
 * C++ two-phase template lookup support.
 *
 * Inside a class template body, names from a dependent base class are NOT
 * found by ordinary unqualified lookup. The standard requires the
 * `this->name` or `Base<T>::name` forms to make the lookup dependent.
 * GitNexus's global free-call fallback otherwise binds such names to the
 * dependent base's members, producing CALLS edges the compiler would
 * reject.
 *
 * This module records — during `emitCppScopeCaptures` — which template
 * class declarations have which dependent base class names (per file).
 * `populateCppDependentBases` then resolves those names to class nodeIds
 * using a workspace-wide registry, building the per-class set the
 * `isCppDependentBaseMember` predicate consumes.
 *
 * Cross-file resolution: `Base<T>` may be declared in a different header
 * than `Derived<T>`. `populateCppDependentBases` therefore runs as a
 * workspace-wide pass (`populateWorkspaceOwners` hook) after every file
 * has had `populateOwners` applied, so all class defs are reachable.
 *
 * Namespace disambiguation: when multiple classes share a simple name
 * (e.g., `Box` in two namespaces), the resolver prefers the candidate
 * whose qualified-name prefix (namespace path) matches the deriving
 * class's prefix. If no namespace match is found, a unique simple-name
 * match is accepted; ambiguous matches (multiple candidates, no
 * namespace winner) are skipped conservatively.
 *
 * NOTE: module-level state, single-process-single-repo use only.
 * `clearFileLocalNames()` clears this state alongside file-local linkage
 * (see `file-local-linkage.ts`).
 */
import type { ParsedFile, ScopeId, SymbolDefinition } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
/**
 * Record a dependent-base relationship discovered during scope-capture
 * emission. `className` is the simple name of the template class;
 * `baseName` is the simple name of the dependent base class.
 * `qualifier` is the syntactic namespace qualifier (e.g. `detail` for
 * `detail::Inner<T>`), or '' for unqualified bases.
 *
 * The capture-time recorder uses simple names because the registry
 * resolution that maps names → nodeIds runs later (in
 * `populateCppDependentBases`).
 */
export declare function markCppDependentBase(filePath: string, className: string, baseName: string, qualifier?: string): void;
export declare function markCppDependentPackBase(filePath: string, className: string): void;
/**
 * Plain-data, JSON-serializable snapshot of the per-file capture-time
 * two-phase-lookup state. Carried on `ParsedFile.captureSideChannel` across the
 * worker→main boundary (#1983). The resolved `dependentBaseNodeIds` index is
 * rebuilt by `populateCppDependentBases` (workspace pass) after all files have
 * their `populateOwners` applied, so only the two capture-time maps cross.
 *
 * Nested `Map`/`Set` are flattened to arrays here so the snapshot stays plain
 * JSON (avoids relying on the parsedfile-store's Map/Set replacer for nested
 * structures): `dependentBases` is `[className, [baseName, qualifiers[]][]][]`.
 */
export interface CppTwoPhaseSideChannel {
    readonly dependentBases: readonly [string, readonly [string, readonly string[]][]][];
    readonly dependentPackBaseClasses: readonly string[];
}
/** Snapshot this file's two-phase-lookup capture state for the side-channel. */
export declare function collectCppTwoPhaseSideChannel(filePath: string): CppTwoPhaseSideChannel;
/** Restore this file's two-phase-lookup capture state from the side-channel. */
export declare function applyCppTwoPhaseSideChannel(filePath: string, data: CppTwoPhaseSideChannel): void;
/** Clear two-phase-lookup state. Called from `clearFileLocalNames`. */
export declare function clearCppDependentBases(): void;
/**
 * Resolve recorded dependent-base simple names to class nodeIds using a
 * workspace-wide index. Run as `populateWorkspaceOwners` after every
 * file has had `populateOwners` applied, so class defs from ALL files
 * are reachable.
 *
 * Disambiguation strategy (multiple classes sharing a simple name):
 *  1. Prefer the candidate whose qualified-name namespace prefix matches
 *     the deriving class's namespace prefix (same-namespace bias).
 *  2. When a syntactic qualifier is available (`detail` in
 *     `detail::Inner<T>`), target the exact namespace derived from it.
 *  3. Fall back to accepting a unique simple-name match.
 *  4. Skip when multiple candidates exist and no namespace match is
 *     found (conservative: avoids false associations).
 */
export declare function populateCppDependentBases(parsedFiles: readonly ParsedFile[]): void;
/**
 * Two-phase lookup predicate: is the candidate def a member of a
 * dependent base of the caller's enclosing template class?
 *
 * Used as an additional reject-filter in `pickUniqueGlobalCallable` and
 * the receiver-bound member chain walk. ONLY apply for unqualified
 * call forms — `this->name` and `Base<T>::name` are dependent lookup
 * forms that the standard allows.
 *
 * Conservative bias: when the caller's enclosing class can't be
 * identified, return `false` (let normal resolution proceed). Over-
 * rejection is acceptable for the template case because the standard
 * itself requires `this->` or qualified forms for dependent base
 * access; missing edges here match the compiler's diagnostic shape.
 */
export declare function isCppDependentBaseMember(callerScopeId: ScopeId, candidateDef: SymbolDefinition, scopes: ScopeResolutionIndexes): boolean;
