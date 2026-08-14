/**
 * Dart `CaptureMatch` → semantic-shape interpreters.
 *
 *   - `interpretDartImport`  — `@import.source` → a whole-library
 *     `ParsedImport` (Dart `import`/`export` bring every public top-level
 *     symbol of the target into scope — whole-library / wildcard-leaf semantics).
 *     `@import.heritage` markers (synthesized by `captures.ts` for
 *     `implements`/`with` clauses) become side-effect imports carrying a
 *     `__heritage__:` payload that `emitDartHeritageEdges` consumes; they
 *     never produce a real IMPORTS edge (`resolveDartImportTarget` returns
 *     `null` for them).
 *   - `interpretDartTypeBinding` — `@type-binding.*` → a `ParsedTypeBinding`,
 *     normalizing the Dart type (strip nullable `?`, unwrap single-arg
 *     container generics like `Future<X>`/`List<X>`, drop library prefixes).
 */
import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
/** Marker prefix carried on a side-effect `ParsedImport.targetRaw` for
 *  `implements`/`with` heritage, consumed by `emitDartHeritageEdges`. Aliased to
 *  the shared codec prefix (#1994) so the Dart wire prefix has a single source of
 *  truth and cannot desync from `encodeMarker`/`decodeMarker`. */
export declare const DART_HERITAGE_PREFIX: string;
export declare function interpretDartImport(captures: CaptureMatch): ParsedImport | null;
export declare function normalizeDartType(text: string): string;
export declare function interpretDartTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
