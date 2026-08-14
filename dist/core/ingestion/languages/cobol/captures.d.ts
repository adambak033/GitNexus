/**
 * `emitScopeCaptures` for COBOL.
 *
 * Wraps the existing regex tagger (`extractCobolSymbolsWithRegex`) and
 * produces parser-agnostic `CaptureMatch[]` matching the RFC §5.1
 * vocabulary. The central `ScopeExtractor` consumes these captures
 * without knowing whether they came from tree-sitter or regex.
 *
 * Pure given the input source text. No I/O, no globals consulted.
 * The regex tagger is synchronous — no async needed.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
export declare function emitCobolScopeCaptures(sourceText: string, _filePath: string, _cachedTree?: unknown): readonly CaptureMatch[];
