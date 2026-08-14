import type { ParseWorkerResult } from './parse-worker.js';
/**
 * Deliver the accumulated result to the pool, surviving a non-cloneable value
 * (#2112). Fast path: post as-is — on a healthy result this is the only thing
 * that runs, so clone-safety adds zero overhead to normal runs. If structured
 * clone rejects the payload (a function/symbol leaked into an extraction
 * record — the reporter's case was a node `properties` value pointing at a
 * native `toString`), rewrite the boundary-crossing arrays so the result is
 * cloneable, record the affected paths on `result.skippedPaths`, warn the
 * operator naming the offending field + file (so the still-unpinned leak is
 * diagnosable from logs and fixable at source), and re-post.
 *
 * Recovery is attempted for ANY first-post failure, not only a `DataCloneError`.
 * structuredClone invokes getters, and a getter that THROWS surfaces its own
 * error (a `RangeError`, etc.) — NOT a `DataCloneError` (confirmed against a
 * real MessageChannel). Gating recovery on `DataCloneError` let such a throw
 * re-throw past the sanitizer and re-arm, under `POOL_SIZE=1`, the worker-death
 * cascade this net prevents. The recovery path is wrapped in its own try/catch
 * so a still-uncloneable re-post fails closed to a primitive-only
 * `{type:'error'}` DELIBERATELY rather than escaping the worker.
 */
export declare function postResultCloneSafe(result: ParseWorkerResult): void;
