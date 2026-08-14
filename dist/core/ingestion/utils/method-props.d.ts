import type { MethodInfo } from '../method-types.js';
import { SupportedLanguages, type ParameterTypeClass } from '../../../_shared/index.js';
/**
 * Compute arity for ID-generation purposes.
 * Returns `undefined` when any parameter is variadic (arity is indeterminate).
 */
export declare function arityForIdFromInfo(info: MethodInfo): number | undefined;
/**
 * Key for the per-class method map built by `getMethodInfo` (parse-worker).
 *
 * `name:line` is NOT unique. Two callables can start on the same line with the
 * same name whenever one of them is SYNTHESIZED at a position that is not its
 * own declaration: a Java record's implicit component accessor is minted at the
 * component (`record P(int x, int y) { int x(int s) {…} }`), and a C# 12 primary
 * constructor at the owner's `parameter_list`
 * (`class Point(int x, int y) { public Point(int x) : this(x, 0) {} }`). Both are
 * appended LAST by their extractor, so under a `name:line` key the synthesized
 * entry silently destroyed the source-written method's MethodInfo and the two
 * ids collapsed onto one node (#2936).
 *
 * `line` is 1-based and `column` is 0-based — deliberately, because this is a
 * join key rather than a displayed location and both sides derive it from the
 * same node. Do not "normalize" one half; the join is the only contract.
 *
 * The KEY is never parsed by any consumer — `buildCollisionGroups`,
 * `typeTagForId` and `constTagForId` all iterate `.values()`. Keep it that way,
 * and never insert one MethodInfo under two keys: those consumers would then
 * count it twice and turn every singleton into a false collision group.
 */
export declare function methodInfoKey(name: string, line: number, column: number): string;
/**
 * Build collision groups from a method map — groups methods by `name#arity`.
 * Call once per class, then pass to typeTagForId/constTagForId to avoid O(N²) scans.
 */
export declare function buildCollisionGroups(methodMap: Map<string, MethodInfo>): Map<string, MethodInfo[]>;
/**
 * Compute a type-based discriminator suffix for same-arity overloads.
 * Returns `~type1,type2` when the current method collides with another method
 * in the same class that has the same name and arity but different parameter types.
 * Returns `''` when there is no collision or types are unavailable.
 */
export declare function typeTagForId(methodMap: Map<string, MethodInfo>, methodName: string, arity: number | undefined, currentInfo: MethodInfo, language?: SupportedLanguages, 
/** Pre-built collision groups from buildCollisionGroups(). Avoids O(N) scan per call. */
collisionGroups?: Map<string, MethodInfo[]>): string;
/**
 * Compute a const-qualifier suffix for C++ const/non-const method collisions.
 * Returns `$const` when the current method is const-qualified and a non-const
 * method with the same name and arity exists in the same class.
 * Returns `''` when there is no collision or the method is not const-qualified.
 */
export declare function constTagForId(methodMap: Map<string, MethodInfo>, methodName: string, arity: number | undefined, currentInfo: MethodInfo, 
/** Pre-built collision groups from buildCollisionGroups(). Avoids O(N) scan per call. */
collisionGroups?: Map<string, MethodInfo[]>): string;
/**
 * Disambiguate function-template overloads whose normalized parameter types
 * intentionally collapse to the same placeholder token (`T`, `U`, ...), but
 * whose C++ sidecar shape is semantically different (`T` vs `T*` / `T&`).
 *
 * Kept intentionally narrow: concrete types already use the existing raw-type
 * overload tag, and non-template languages should not acquire sidecar-shaped
 * IDs.
 */
export declare function parameterShapeIdTag(parameterTypes?: readonly string[], parameterTypeClasses?: readonly ParameterTypeClass[]): string;
/** Convert MethodInfo from methodExtractor into flat properties for a graph node. */
export declare function buildMethodProps(info: MethodInfo): Record<string, unknown>;
