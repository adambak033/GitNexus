let hits = 0;
let misses = 0;
export function recordRubyCacheHit() {
    hits++;
}
export function recordRubyCacheMiss() {
    misses++;
}
export function getRubyCaptureCacheStats() {
    return { hits, misses };
}
export function resetRubyCaptureCacheStats() {
    hits = 0;
    misses = 0;
}
