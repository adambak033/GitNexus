/**
 * Idempotently install the onnxruntime-common resolution fallback. Call once
 * immediately before the dynamic `import('@huggingface/transformers')` on the
 * local-embedding path.
 */
export declare const ensureOnnxRuntimeCommonResolvable: () => void;
