export type CudaMajor = 12 | 13;
/** The CUDA major an onnxruntime-node copy's CUDA provider links against, or null (Linux/x64 only ships one). */
export declare const ortCudaMajor: (ortNodeDir: string) => CudaMajor | null;
/** The cuBLASLt major installed on this system, or null. Linux only. */
export declare const detectSystemCudaMajor: () => CudaMajor | null;
/**
 * The onnxruntime-node dir that will actually back transformers at runtime once
 * {@link ensureOnnxRuntimeNodeMatchesSystem} has run — i.e. the redirected copy
 * when a redirect applies, otherwise transformers' default. The CUDA probe must
 * inspect THIS dir (not transformers' CJS-resolved default) so probe and
 * runtime agree. Returns null only when neither copy resolves.
 */
export declare const getEffectiveOnnxRuntimeNodeDir: () => string | null;
/**
 * Whether the onnxruntime-node copy that will actually load ships a CUDA
 * provider matching this host's CUDA major — reads straight from the cached
 * `decide()` result rather than re-probing `ortCudaMajor`/`detectSystemCudaMajor`
 * a second time (both are already computed above). `systemMajor` is checked
 * for non-null explicitly so two absent majors (null === null) never count
 * as a match.
 */
export declare const isEffectiveCudaAvailable: () => boolean;
/**
 * CUDA-build-redirect status for the `doctor` Embeddings section — pure
 * summary of decide()'s already-computed decision, matching
 * doctor.ts's `localEmbeddingDoctorStatus`'s `{status, detail}` shape so an
 * operator can tell "why is my CUDA-13 host still on CPU" apart from
 * "there's no system CUDA to redirect for" at a glance.
 */
export declare const cudaRedirectDoctorStatus: () => {
    status: string;
    detail: string | null;
};
/**
 * Idempotently install the CUDA-build-matching redirect. Call once immediately
 * before the dynamic `import('@huggingface/transformers')` on the local
 * embedding path (after the runtime guard, alongside the onnxruntime-common
 * fallback). No-op unless a strictly-better matching copy exists.
 */
export declare const ensureOnnxRuntimeNodeMatchesSystem: () => void;
