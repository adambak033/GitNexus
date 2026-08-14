export declare function recordGoCacheHit(): void;
export declare function recordGoCacheMiss(): void;
export declare function getGoCaptureCacheStats(): {
    readonly hits: number;
    readonly misses: number;
};
export declare function resetGoCaptureCacheStats(): void;
