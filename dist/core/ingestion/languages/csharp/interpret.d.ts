/**
 * Capture-match → semantic-shape interpreters for C#.
 *
 *   - `interpretCsharpImport`     → `ParsedImport`
 *   - `interpretCsharpTypeBinding` → `ParsedTypeBinding`
 *
 * The using-directive matches arrive pre-decomposed by
 * `emitCsharpScopeCaptures` (one import per match, with synthesized
 * `@import.kind/source/name/alias` markers). Type-binding matches arrive
 * from the raw query captures — each `@type-binding.*` anchor carries
 * `@type-binding.name` + `@type-binding.type`.
 */
import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
export declare function interpretCsharpImport(captures: CaptureMatch): ParsedImport | null;
export declare function interpretCsharpTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
