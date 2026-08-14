/**
 * Local agent CLI clients for wiki generation.
 *
 * These providers use the user's authenticated local CLI session instead of
 * an OpenAI-compatible HTTP API.
 */
import type { LLMResponse, CallLLMOptions } from './llm-client.js';
export type LocalAgentProvider = 'claude' | 'codex' | 'opencode';
export interface LocalCLIConfig {
    model?: string;
    workingDirectory?: string;
    requestTimeoutMs?: number;
}
export declare function detectLocalCLI(provider: LocalAgentProvider): string | null;
export declare function resolveLocalCLIConfig(overrides?: Partial<LocalCLIConfig>): LocalCLIConfig;
export declare function callClaudeLLM(prompt: string, config: LocalCLIConfig, systemPrompt?: string, options?: CallLLMOptions): Promise<LLMResponse>;
export declare function callCodexLLM(prompt: string, config: LocalCLIConfig, systemPrompt?: string, options?: CallLLMOptions): Promise<LLMResponse>;
export declare function callOpenCodeLLM(prompt: string, config: LocalCLIConfig, systemPrompt?: string, options?: CallLLMOptions): Promise<LLMResponse>;
