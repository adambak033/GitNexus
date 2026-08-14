/**
 * C++ conversion-rank scoring for overload resolution (#1578, #1637).
 *
 * Operates on normalized type strings (output of `normalizeCppParamType`
 * in `arity-metadata.ts`) plus optional shape sidecars from #1630.
 * Normalization intentionally collapses cv/ref/pointer spelling for stable
 * graph IDs, so pointer/nullptr rules must consult `ParameterTypeClass`.
 *
 * Post-normalization ranking:
 *   - rank 0: exact (same normalized type)
 *   - rank 1: integral promotion (char -> int, bool -> int)
 *   - rank 2: standard conversion (arithmetic, nullptr -> T*, T* -> bool,
 *             T* -> void*)
 *   - rank 3: nullptr -> bool (kept worse than nullptr -> T*)
 *   - rank 4: user-defined conversion (one-step, conservative)
 *   - rank 5: ellipsis conversion (worst viable)
 *   - Infinity: mismatch (string -> int, user types, unsupported shapes)
 *
 * This function is intentionally C++-specific. Other languages may define
 * their own `ConversionRankFn` in the future.
 */
import type { ParameterTypeClass } from '../../../../_shared/index.js';
export declare const CPP_BRACED_INIT_TYPE_PREFIX = "braced-init:";
export declare const CPP_CONVERSION_ONLY_ARG_TYPE_PREFIXES: readonly ["braced-init:"];
/**
 * Return the conversion rank from `argType` to `paramType`.
 *
 * @returns 0 for exact match, 1 for integral promotion, 2 for standard
 *          conversion, 3 for nullptr -> bool, 4 for user-defined conversion,
 *          5 for ellipsis, Infinity
 *          for mismatch.
 */
export declare function cppConversionRank(argType: string, paramType: string, argTypeClass?: ParameterTypeClass, paramTypeClass?: ParameterTypeClass): number;
