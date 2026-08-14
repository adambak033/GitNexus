/**
 * Dev-mode counters for the cross-phase scope-captures parse cache
 * (Swift mirror of `languages/csharp/cache-stats.ts`).
 *
 * Gated by `PROF_SCOPE_RESOLUTION=1`. Production builds fold every
 * increment into dead code via the module-level `PROF` constant, so
 * the hot path in `captures.ts` stays branch-free.
 */
export declare function recordCacheHit(): void;
export declare function recordCacheMiss(): void;
export declare function getSwiftCaptureCacheStats(): {
    hits: number;
    misses: number;
};
export declare function resetSwiftCaptureCacheStats(): void;
