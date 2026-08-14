/**
 * Merge of accumulated parse-worker results (sub-batch result → the conceptual
 * job's running accumulator).
 *
 * Extracted from `parse-worker.ts` into this side-effect-free module so the
 * merge can be imported and unit-tested directly — the parse worker is an entry
 * module (importing it constructs the parser, posts `ready`, and attaches the
 * real MessagePort handler), so a main-thread test cannot import a helper out of
 * it. Mirrors the `post-result.ts` extraction.
 *
 * `import type` of `ParseWorkerResult` is erased at runtime, so there is no
 * import cycle with `parse-worker.ts` (which imports this module's runtime).
 */
import type { ParseWorkerResult } from './parse-worker.js';
/**
 * Merge `src` into `target` in place: append every boundary-crossing array,
 * sum the per-language skip counts, union the clone-safety `skippedPaths`, and
 * add the file count.
 */
export declare const mergeResult: (target: ParseWorkerResult, src: ParseWorkerResult) => void;
