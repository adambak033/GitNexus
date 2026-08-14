/**
 * Capture-match → semantic-shape interpreters for Java.
 *
 *   - `interpretJavaImport`       → `ParsedImport`
 *   - `interpretJavaTypeBinding`  → `ParsedTypeBinding`
 *
 * Import matches arrive pre-decomposed by `emitJavaScopeCaptures`
 * (one import per match, with synthesized `@import.kind/source/name`
 * markers). Type-binding matches arrive from the raw query captures.
 */
import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
export declare function interpretJavaImport(captures: CaptureMatch): ParsedImport | null;
export declare function interpretJavaTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
