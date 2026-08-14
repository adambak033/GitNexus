export declare function recordKotlinCacheHit(): void;
export declare function recordKotlinCacheMiss(): void;
export declare function getKotlinCaptureCacheStats(): {
    readonly hits: number;
    readonly misses: number;
};
export declare function resetKotlinCaptureCacheStats(): void;
