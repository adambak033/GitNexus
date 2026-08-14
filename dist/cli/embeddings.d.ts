export interface EmbeddingsInstallOptions {
    cuda?: boolean;
    force?: boolean;
}
/**
 * `gitnexus embeddings install [--cuda] [--force]` — fetch the optional local
 * embedding stack on demand (#2370). Goes through the user's npm registry
 * config (mirrors/proxies apply); with --cuda it additionally runs
 * onnxruntime-node's postinstall to download the CUDA GPU binaries from NuGet
 * (set GLOBAL_AGENT_HTTPS_PROXY behind a proxy).
 */
export declare const embeddingsInstallCommand: (options?: EmbeddingsInstallOptions) => Promise<void>;
