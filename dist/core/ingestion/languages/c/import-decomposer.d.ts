import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Decompose a `preproc_include` node into a CaptureMatch with structured
 * import captures. C #include maps to a wildcard import (all symbols
 * from the header are visible).
 *
 * Only literal include paths are emitted as import sources:
 *   #include <stdio.h>   → system_lib_string
 *   #include "local.h"   → string_literal
 * A computed include like `#include HEADER_MACRO` carries an `identifier`
 * path node (the macro name, not a header path). Emitting it as an import
 * source produces a garbage literal edge, so we skip it entirely — matching
 * the convention in interpretCImport, which drops imports with no resolvable
 * source (issue #1919 F5).
 */
export declare function splitCInclude(node: SyntaxNode): CaptureMatch | null;
