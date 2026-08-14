let hits = 0;
let misses = 0;
export function recordKotlinCacheHit() {
    hits += 1;
}
export function recordKotlinCacheMiss() {
    misses += 1;
}
export function getKotlinCaptureCacheStats() {
    return { hits, misses };
}
export function resetKotlinCaptureCacheStats() {
    hits = 0;
    misses = 0;
}
