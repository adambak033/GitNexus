export declare function recordRustCacheHit(): void;
export declare function recordRustCacheMiss(): void;
export declare function getRustCaptureCacheStats(): {
    readonly hits: number;
    readonly misses: number;
};
export declare function resetRustCaptureCacheStats(): void;
