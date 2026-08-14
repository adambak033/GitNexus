/**
 * Dev-mode (`PROF_SCOPE_RESOLUTION=1`) cache hit/miss counters for the
 * cross-phase scope-captures parse cache. A module-level `PROF` const folds
 * increments to dead code in production so `captures.ts` stays branch-free.
 * Mirror of `languages/swift/cache-stats.ts`.
 */
export declare function recordCacheHit(): void;
export declare function recordCacheMiss(): void;
export declare function getDartCaptureCacheStats(): {
    hits: number;
    misses: number;
};
export declare function resetDartCaptureCacheStats(): void;
