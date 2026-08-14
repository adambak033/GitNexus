/**
 * Structured-clone safety for the worker result boundary (#2112).
 *
 * A parse worker delivers its accumulated result to the main thread via
 * `parentPort.postMessage(...)`. Node serializes that payload with the
 * structured-clone algorithm SYNCHRONOUSLY on the worker thread, and it
 * THROWS a `DataCloneError` the instant it meets a value it can't serialize —
 * a function, a symbol, a Promise, a WeakMap, etc. The reporter of #2112 hit
 * exactly this: a node record whose `properties` carried an own-enumerable
 * value pointing at a native function (`function toString() { [native code] }
 * could not be cloned`). One such value aborted the entire parse phase,
 * because the worker re-posts the throw as `{type:'error'}` which the pool
 * counts as a worker death — and under `GITNEXUS_WORKER_POOL_SIZE=1` the same
 * graph re-throws on every respawn until the slot's budget is exhausted.
 *
 * This module is the safety net. It runs ONLY after a real clone failure on
 * the fast-path post (zero overhead on healthy runs), and rewrites the
 * boundary-crossing arrays so the result becomes cloneable: a non-cloneable
 * value inside a plain extraction record is dropped (the record is otherwise
 * kept — strictly-missing data, never wrong), and a `ParsedFile` that can't be
 * made cloneable is dropped whole so scope-resolution re-derives it on the
 * main thread (where there is no clone boundary) with intact edge data.
 *
 * Language-neutral by construction: it keys on value shape and field name
 * only, never on a language (AGENTS.md shared-pipeline rule). The strip
 * semantics mirror what the store path's `JSON.stringify` already silently
 * drops, so store / no-store / cold / warm runs converge on the same graph.
 */
/** A file whose parse result was sanitized or dropped at the clone boundary. */
export interface SkippedPath {
    /** Best-effort source path of the offending record (or `(unknown)`). */
    path: string;
    /** Human-readable reason, e.g. "dropped 1 non-serializable value from nodes". */
    reason: string;
}
/**
 * True iff `value` survives Node's structured-clone algorithm (the same
 * algorithm `postMessage` uses). This is the authoritative probe — it matches
 * the real failure exactly, including Map/Set/Date/RegExp/TypedArray support,
 * so it never false-positives on the `Scope` Maps that clone fine.
 */
export declare function isStructuredCloneable(value: unknown): boolean;
/** The leaf values the structured-clone algorithm copies verbatim. */
type CloneablePrimitive = undefined | null | boolean | number | bigint | string;
/**
 * Maps `T` to itself when every value reachable from it is structured-clone
 * safe, and to a type containing `never` at the first offending property
 * otherwise. A function or symbol — the values `postMessage` rejects — becomes
 * `never`, so a struct carrying one is no longer assignable to its own
 * `Cloneable<T>` and `assertCloneable` rejects it, naming the bad key.
 *
 * Implemented as a homomorphic mapped type (`{ [K in keyof T]: … }`) so it
 * preserves `interface` shapes and `readonly` modifiers and works WITHOUT
 * requiring the payload types to carry an index signature — sidestepping the
 * "closed interface is not assignable to a recursive index-signature type" wall
 * that blocked the value-typed-`Cloneable` approach (#2143). `Map`/`Set`/array
 * containers recurse into their element types; `Date`/`RegExp` are clone-safe
 * leaves.
 */
/** True iff `T` is `any` (the canonical `IsAny` probe: only `any` satisfies `0 extends 1 & T`). */
type IsAny<T> = 0 extends 1 & T ? true : false;
export type Cloneable<T> = IsAny<T> extends true ? never : T extends CloneablePrimitive | Date | RegExp ? T : T extends (...args: never[]) => unknown ? never : T extends symbol ? never : T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<Cloneable<K>, Cloneable<V>> : T extends ReadonlySet<infer U> ? ReadonlySet<Cloneable<U>> : T extends readonly (infer U)[] ? T extends unknown[] ? Cloneable<U>[] : readonly Cloneable<U>[] : T extends object ? {
    [K in keyof T]: Cloneable<T[K]>;
} : never;
/**
 * Identity at runtime (zero cost — returns its argument unchanged); a
 * compile-time assertion that `value` is structured-clone safe. Wrap a
 * producer that feeds an `unknown` worker-result sink:
 *
 *   collectCaptureSideChannel: (filePath) => assertCloneable(collectFoo(filePath))
 *
 * If `collectFoo`'s return type ever gains a non-cloneable member (a function, a
 * `SyntaxNode`, …) the call fails to compile, pointing at the offending key.
 *
 * The parameter is a conditional type rather than an `extends Cloneable<T>`
 * constraint because a self-referential constraint (`T extends Cloneable<T>`)
 * is a "circular constraint" error in TypeScript. For a clone-safe `T` the
 * parameter resolves to `T` (call type-checks as a plain identity); for an
 * unsafe `T` it resolves to `Cloneable<T>` (which has `never` at the bad key),
 * so the argument is rejected.
 */
export declare function assertCloneable<T>(value: T extends Cloneable<T> ? T : Cloneable<T>): T;
export interface MakeCloneSafeOptions {
    /**
     * Array field names whose offending elements are DROPPED whole rather than
     * stripped in place (e.g. `parsedFiles` — its `captureSideChannel` drives
     * edge resolution, so a stripped-and-delivered file would ship WRONG edges;
     * dropping it lets scope-resolution re-derive it on the main thread).
     */
    dropWholeElement: ReadonlySet<string>;
    /** Field names to skip entirely (e.g. the `skippedPaths` field itself). */
    skipFields?: ReadonlySet<string>;
    /** Keys to probe for a file path when attributing a skip. */
    pathKeys?: readonly string[];
}
/**
 * Make a worker result's boundary-crossing array fields structured-cloneable,
 * mutating `result` in place. Only arrays that actually contain a
 * non-cloneable value are rewritten; everything else keeps referential
 * identity. Returns the list of affected file paths for reporting.
 *
 * Call this after ANY failure of the fast-path post — a `DataCloneError`, OR a
 * throwing getter's own error surfaced by structuredClone (the caller in
 * `post-result.ts` recovers on any throw, not only `DataCloneError`).
 */
export declare function makeWorkerResultCloneSafe(result: Record<string, unknown>, options: MakeCloneSafeOptions): {
    skipped: SkippedPath[];
};
export {};
