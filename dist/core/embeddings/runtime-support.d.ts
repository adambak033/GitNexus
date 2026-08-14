export interface LocalEmbeddingRuntimeOptions {
    platform?: NodeJS.Platform;
    arch?: NodeJS.Architecture;
}
/**
 * Return a human-readable explanation when the *local* embedding runtime cannot
 * load on this platform, or `null` when local embeddings are expected to work.
 *
 * Only `darwin`/`x64` is blocked today: it is the one platform/arch pair where
 * the bundled `onnxruntime-node` ships no native binding (#1515). Every other
 * platform returns `null` and follows the normal device-probe path, so genuine
 * ONNX failures on supported platforms are never masked by this message.
 *
 * Accepts an explicit `{ platform, arch }` for testing; defaults to the current
 * process values.
 */
export declare const getLocalEmbeddingRuntimeBlocker: (options?: LocalEmbeddingRuntimeOptions) => string | null;
/**
 * True when `message` is the macOS-Intel local-embedding blocker produced by
 * {@link getLocalEmbeddingRuntimeBlocker}. Lets the CLI surface a clean,
 * actionable message instead of a raw stack trace, without coupling to the
 * full wording.
 */
export declare const isLocalEmbeddingRuntimeBlockerMessage: (message: string) => boolean;
/**
 * The full guidance shown when the optional local embedding stack
 * (`@huggingface/transformers` → `onnxruntime-node`) is missing at runtime.
 *
 * Both packages are `optionalDependencies` (#2370): `onnxruntime-node`'s
 * postinstall downloads CUDA support binaries from api.nuget.org, which fails
 * behind HTTP proxies and regional firewalls (its `global-agent` proxy layer
 * ignores the standard HTTP_PROXY/HTTPS_PROXY vars and rejects 302 redirects).
 * npm then skips the optional subtree instead of failing the whole install —
 * every GitNexus feature except local embeddings keeps working.
 */
export declare const localEmbeddingStackMissingMessage: () => string;
/**
 * Guidance when the runtime-prefix stack cannot be used because this Node lacks
 * `module.registerHooks` (added in 22.15 / 23.5) — whether the prefix is already
 * populated or not, this Node's ESM loader can never reach a prefix-installed
 * copy (#2372). A normally-installed (package) stack never needs the hook and
 * never hits this. State-neutral lead (it applies both when the prefix is
 * populated and when nothing is installed) plus capability-first wording — a
 * bare ">= 22.15" is untruthful for a 23.0–23.4 user whose version is
 * numerically greater yet still lacks the API.
 */
export declare const localEmbeddingPrefixUnloadableMessage: () => string;
/**
 * When `err` is a module-not-found failure for the optional local embedding
 * stack, return the actionable {@link localEmbeddingStackMissingMessage};
 * otherwise `null` so genuine load errors surface unchanged.
 *
 * Matches on the error `code` (ERR_MODULE_NOT_FOUND for ESM `import()`,
 * MODULE_NOT_FOUND for CJS require) plus the missing specifier in the message,
 * so an unrelated module-not-found inside transformers.js is not misreported
 * as a pruned install.
 */
export declare const getMissingLocalEmbeddingStackMessage: (err: unknown) => string | null;
/**
 * True when `message` is the missing-optional-stack message produced by
 * {@link localEmbeddingStackMissingMessage}. CLI counterpart of
 * {@link isLocalEmbeddingRuntimeBlockerMessage}.
 */
export declare const isMissingLocalEmbeddingStackMessage: (message: string) => boolean;
/**
 * True when the optional local embedding stack resolves from this install —
 * either the normally-installed packages or the on-demand runtime prefix.
 * Resolution only — nothing is imported, so this is safe on every platform
 * (including macOS Intel, where *loading* onnxruntime-node would crash).
 * Used by `doctor` to surface a pruned optional install (#2370) up front.
 */
export declare const isLocalEmbeddingStackInstalled: () => boolean;
