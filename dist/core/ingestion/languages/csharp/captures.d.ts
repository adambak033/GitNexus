/**
 * `emitScopeCaptures` for C#.
 *
 * Drives the C# scope query against tree-sitter-c-sharp and groups raw
 * matches into `CaptureMatch[]` for the central extractor. Layers one
 * synthesized stream on top today:
 *
 *   1. **Decomposed using directives** — each `using_directive` is
 *      re-emitted with `@import.kind/source/name/alias` markers so
 *      `interpretCsharpImport` can recover the ParsedImport shape
 *      without re-parsing raw text (see `import-decomposer.ts`).
 *
 * Receiver-binding synthesis (`this` / `base` type anchors) and arity
 * metadata synthesis (Unit 5) layer on top later.
 *
 * Pure given the input source text. No I/O, no globals consulted.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
export declare function emitCsharpScopeCaptures(sourceText: string, _filePath: string, cachedTree?: unknown): readonly CaptureMatch[];
