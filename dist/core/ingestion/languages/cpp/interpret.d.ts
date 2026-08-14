import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
/**
 * Interpret a C++ import capture into a ParsedImport.
 *
 * C++ has three import forms:
 *   1. #include "file.h"  → wildcard import (all symbols from header)
 *   2. using namespace X; → wildcard import (all symbols from namespace X)
 *   3. using X::name;     → named import (single symbol from namespace X)
 *
 * System headers (#include <...>) are not resolved to local files.
 */
export declare function interpretCppImport(captures: CaptureMatch): ParsedImport | null;
/**
 * Interpret a C++ type-binding capture into a ParsedTypeBinding.
 *
 * Source classification (strongest → weakest):
 *   - `'parameter-annotation'` — function parameter type
 *   - `'annotation'`          — explicit type declaration (`User user;`)
 *   - `'assignment-inferred'` — typed init (`User user = ...`)
 *   - `'constructor'`         — constructor call (`auto u = User(...)` / `User{}`)
 *   - `'return'`              — function return type
 *   - `'field'`               — class field type
 *   - `'alias'`               — `auto x = existingVar`
 */
export declare function interpretCppTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
/** Remove C++ declaration specifiers from `text` and trim the result. */
export declare function stripCppSpecifiers(text: string): string;
/**
 * Normalize a C++ type name: strip pointer/array/reference syntax,
 * qualifiers, while preserving template arguments for specialization-aware
 * receiver binding (`List<User>` vs `List<Order>`).
 *
 * Keeping template arguments here allows receiver-bound fallback to match
 * specialization-specific class defs first; non-template behavior is preserved
 * by base-name fallback in resolveClassBindingForName.
 */
export declare function normalizeCppTypeName(text: string): string;
