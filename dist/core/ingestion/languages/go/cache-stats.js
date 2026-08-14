let hits = 0;
let misses = 0;
export function recordGoCacheHit() {
    hits++;
}
export function recordGoCacheMiss() {
    misses++;
}
export function getGoCaptureCacheStats() {
    return { hits, misses };
}
export function resetGoCaptureCacheStats() {
    hits = 0;
    misses = 0;
}
