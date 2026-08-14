/**
 * Quarantine layer (Layer 3 of the worker-pool resilience model).
 *
 * Tracks paths that caused a worker death this pool lifetime and must
 * not be re-dispatched to a worker. Session-scoped — created once per
 * `createWorkerPool` invocation and discarded with the pool.
 *
 * This module is the first piece of the U13 layer-extraction work. The
 * doc-review's A10 finding flagged the full 5-module split as
 * abstraction-without-multi-consumer-demand, so the rest of the
 * extraction is deferred until a real second consumer emerges (e.g., a
 * non-parse worker pool that reuses the same resilience layers).
 * Extracting the smallest self-contained layer first validates the
 * factory + interface pattern with minimal risk: behavior is unchanged,
 * the worker-pool.ts public API is unchanged, and existing tests act as
 * the regression net.
 */
/**
 * Construct a fresh quarantine. Each `createWorkerPool` invocation gets
 * its own instance — quarantines never outlive the pool that created
 * them. The implementation is a thin wrapper around `Set<string>`; the
 * named interface exists to make the resilience layer addressable as a
 * unit (named module, dedicated tests) instead of an inline Set field
 * tangled into 1100+ LOC of pool plumbing.
 */
export function createQuarantine() {
    const paths = new Set();
    return {
        add: (path) => {
            paths.add(path);
        },
        has: (path) => paths.has(path),
        snapshot: () => Array.from(paths),
        get size() {
            return paths.size;
        },
    };
}
