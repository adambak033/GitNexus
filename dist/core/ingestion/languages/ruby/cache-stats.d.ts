export declare function recordRubyCacheHit(): void;
export declare function recordRubyCacheMiss(): void;
export declare function getRubyCaptureCacheStats(): {
    readonly hits: number;
    readonly misses: number;
};
export declare function resetRubyCaptureCacheStats(): void;
