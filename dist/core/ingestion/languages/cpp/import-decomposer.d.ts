import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Decompose a `preproc_include` node into a CaptureMatch with structured
 * import captures. C++ #include maps to a wildcard import (all symbols
 * from the header are visible). Identical to C's splitCInclude.
 *
 * Only literal include paths are emitted as import sources:
 *   #include <map>      → system_lib_string
 *   #include "User.h"   → string_literal
 * A computed include like `#include HEADER_MACRO` carries an `identifier`
 * path node (the macro name, not a header path); we skip it so it never
 * becomes a garbage literal import source (issue #1919 F5).
 */
export declare function splitCppInclude(node: SyntaxNode): CaptureMatch | null;
/**
 * Decompose a `using_declaration` node into a CaptureMatch.
 *
 * tree-sitter-cpp produces:
 *   using namespace std;  → using_declaration { "using", "namespace", identifier("std"), ";" }
 *   using std::vector;    → using_declaration { "using", qualified_identifier("std::vector"), ";" }
 *
 * The first form is a wildcard import (all names from namespace).
 * The second form is a named import (single symbol).
 */
export declare function splitCppUsingDecl(node: SyntaxNode): CaptureMatch | null;
