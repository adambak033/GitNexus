/**
 * Dev-mode counters for the cross-phase scope-captures parse cache.
 *
 * Gated by `PROF_SCOPE_RESOLUTION=1`. In production the module-level
 * `PROF` constant is `false` and V8 folds every increment site into
 * dead code, so the hot path in `captures.ts` stays branch-free.
 *
 * Extracted from `captures.ts` so the production hot-path module
 * doesn't carry a module-global counter and its reset/export surface.
 */
export declare function recordCacheHit(): void;
export declare function recordCacheMiss(): void;
export declare function getPythonCaptureCacheStats(): {
    hits: number;
    misses: number;
};
export declare function resetPythonCaptureCacheStats(): void;
