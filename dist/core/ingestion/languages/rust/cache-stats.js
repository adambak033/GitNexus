let hits = 0;
let misses = 0;
export function recordRustCacheHit() {
    hits++;
}
export function recordRustCacheMiss() {
    misses++;
}
export function getRustCaptureCacheStats() {
    return { hits, misses };
}
export function resetRustCaptureCacheStats() {
    hits = 0;
    misses = 0;
}
