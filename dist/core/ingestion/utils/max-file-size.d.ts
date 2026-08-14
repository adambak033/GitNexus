/** Default threshold (512 KB). Files larger than this are skipped by the walker. */
export declare const DEFAULT_MAX_FILE_SIZE_BYTES: number;
/** Hard upper bound — tree-sitter refuses buffers above this regardless. */
export declare const MAX_FILE_SIZE_UPPER_BOUND_BYTES: number;
/**
 * Resolve the effective file-size skip threshold (bytes) for the walker.
 * Reads `GITNEXUS_MAX_FILE_SIZE` (KB). Invalid values fall back to the default
 * and emit a one-time warning. Values above the tree-sitter ceiling are clamped.
 */
export declare const getMaxFileSizeBytes: () => number;
/**
 * Build the CLI banner message announcing an active file-size override.
 * Returns `null` when the effective threshold equals the default — the caller
 * should print nothing in that case. The returned message reflects the
 * *effective* post-clamp threshold, not the raw env value, so operators reading
 * startup output see the actual configuration the walker will use.
 */
export declare const getMaxFileSizeBannerMessage: () => string | null;
/** Test-only: reset the warn-once cache so repeated test runs can re-observe warnings. */
export declare const _resetMaxFileSizeWarnings: () => void;
