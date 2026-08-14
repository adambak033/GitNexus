/**
 * LLM Client for Wiki Generation
 *
 * OpenAI-compatible API client using native fetch.
 * Supports MiniMax and other OpenAI-compatible endpoints.
 *
 * Config priority: CLI flags > env vars > defaults
 */
export type LLMProvider = 'openai' | 'openrouter' | 'azure' | 'custom' | 'cursor' | 'claude' | 'codex' | 'opencode' | 'minimax';
export declare const MINIMAX_OPENAI_BASE_URLS: {
    readonly global_en: "https://api.minimax.io/v1";
    readonly cn_zh: "https://api.minimaxi.com/v1";
};
export declare const MINIMAX_MODEL_IDS: readonly ["MiniMax-M3", "MiniMax-M2.7"];
export type MiniMaxThinkingMode = 'adaptive' | 'disabled' | 'always_on';
export type LLMUserContent = string | Array<{
    type: 'text';
    text: string;
} | {
    type: 'image_url';
    image_url: {
        url: string;
        detail?: 'low' | 'default' | 'high';
        max_long_side_pixel?: number;
    };
} | {
    type: 'video_url';
    video_url: {
        url: string;
        detail?: 'low' | 'default' | 'high';
        fps?: number;
        max_long_side_pixel?: number;
    };
}>;
export interface LLMConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
    temperature: number;
    /** Provider type — controls auth header behaviour */
    provider?: LLMProvider;
    /** Azure api-version query param (e.g. '2024-10-21'). Appended to URL when set. */
    apiVersion?: string;
    /** When true, strips sampling params and uses max_completion_tokens instead of max_tokens */
    isReasoningModel?: boolean;
    /** Per-attempt fetch timeout in ms. Omit to disable request timeouts. */
    requestTimeoutMs?: number;
    /** Max fetch attempts before giving up (default: 3). */
    maxAttempts?: number;
    /** Exact hostnames allowed for explicit http:// LLM endpoints. */
    allowedInsecureHttpHosts?: readonly string[];
}
export interface LLMResponse {
    content: string;
    promptTokens?: number;
    completionTokens?: number;
}
export declare function resolveMiniMaxThinkingMode(model: string, reasoningOverride?: boolean): MiniMaxThinkingMode | undefined;
/**
 * Resolve LLM configuration from env vars, saved config, and optional overrides.
 * Priority: overrides (CLI flags) > env vars > ~/.gitnexus/config.json > error
 *
 * If no API key is found, returns config with empty apiKey (caller should handle).
 */
export declare function resolveLLMConfig(overrides?: Partial<LLMConfig>): Promise<LLMConfig>;
/**
 * Estimate token count from text (rough heuristic: ~4 chars per token).
 */
export declare function estimateTokens(text: string): number;
export declare const LLM_ALLOW_INSECURE_CONNECTION_ENV = "GITNEXUS_ALLOW_INSECURE_CONNECTION";
export declare function parseLLMAllowedInsecureHttpHosts(value: string | undefined): string[];
/**
 * Validate that a base URL supplied for LLM API calls is a safe HTTP/HTTPS
 * endpoint (CWE-918 / CodeQL js/http-to-file-access).
 *
 * Allowed:
 *  - https:// with any hostname (public LLM APIs, Azure, OpenRouter, …)
 *  - http:// restricted to localhost / 127.0.0.1 (local servers: Ollama, LiteLLM, …)
 *  - http:// to exact hosts explicitly allowlisted for LAN/self-hosted LLMs
 *
 * Rejected:
 *  - file://, data:, javascript:, and any other non-HTTP scheme
 *  - http:// aimed at non-loopback hosts unless explicitly allowlisted
 *    (avoids SSRF against internal networks by default)
 *
 * Throws with a descriptive message on validation failure so callers surface a
 * clear error rather than an opaque network error.
 */
export declare function validateLLMBaseUrl(baseUrl: string, allowedInsecureHttpHosts?: readonly string[]): void;
/**
 * Returns true if the given base URL is an Azure OpenAI endpoint.
 * Uses proper hostname matching to avoid spoofed URLs like
 * "https://myresource.openai.azure.com.evil.com/v1".
 */
export declare function isAzureProvider(baseUrl: string): boolean;
/**
 * Returns true if the model name matches a known reasoning model pattern,
 * or if the explicit override is true.
 * Pass override=false to force non-reasoning even for o-series names.
 */
export declare function isReasoningModel(model: string, override?: boolean): boolean;
/**
 * Build the full chat completions URL, appending ?api-version when provided.
 */
export declare function buildRequestUrl(baseUrl: string, apiVersion: string | undefined): string;
export interface CallLLMOptions {
    onChunk?: (charsReceived: number) => void;
}
/**
 * Call an OpenAI-compatible LLM API.
 * Uses streaming when onChunk callback is provided for real-time progress.
 * Retries up to 3 times on transient failures (429, 5xx, network errors).
 */
export declare function callLLM(prompt: LLMUserContent, config: LLMConfig, systemPrompt?: string, options?: CallLLMOptions): Promise<LLMResponse>;
