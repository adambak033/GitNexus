/**
 * `emitScopeCaptures` for Python.
 *
 * Drives the scope query against `tree-sitter-python` and groups raw
 * matches into `CaptureMatch[]` for the central extractor, then layers
 * two synthesized streams on top:
 *
 *   1. **Per-name import statements** — `import a, b` and
 *      `from m import x, y` decompose to one match per imported name
 *      (see `import-decomposer.ts`).
 *   2. **Receiver type bindings** — methods emit an implicit `self` / `cls`
 *      binding, and `__init__` assignments from annotated parameters emit
 *      class-scoped instance-field bindings (see `receiver-binding.ts`).
 *
 * Pure given the input source text. No I/O, no globals consulted.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
export declare function emitPythonScopeCaptures(sourceText: string, _filePath: string, cachedTree?: unknown): readonly CaptureMatch[];
