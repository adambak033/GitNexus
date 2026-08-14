/**
 * `emitScopeCaptures` for Java.
 *
 * Drives the Java scope query against tree-sitter-java and groups raw
 * matches into `CaptureMatch[]` for the central extractor. Layers:
 *
 *   1. **Decomposed import declarations** — each `import_declaration`
 *      is re-emitted with `@import.kind/source/name` markers.
 *   2. **Receiver binding synthesis** — `this`/`super` type-bindings
 *      on instance methods.
 *   3. **Arity metadata** on method/constructor declarations.
 *   4. **Reference arity** on call sites.
 *
 * The returned captures are deterministic. Class-annotation facts are also
 * recorded for the worker side-channel consumed after scope resolution.
 */
import { type CaptureMatch } from '../../../../_shared/index.js';
export declare function emitJavaScopeCaptures(sourceText: string, filePath: string, cachedTree?: unknown): readonly CaptureMatch[];
