/**
 * Wiki Command
 *
 * Generates repository documentation from the knowledge graph.
 * Usage: gitnexus wiki [path] [options]
 */
import { type LLMProvider } from '../core/wiki/llm-client.js';
export interface WikiCommandOptions {
    force?: boolean;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    apiVersion?: string;
    reasoningModel?: boolean;
    concurrency?: string;
    gist?: boolean;
    provider?: LLMProvider;
    verbose?: boolean;
    review?: boolean;
    timeout?: string;
    retries?: string;
    lang?: string;
    allowInsecureConnection?: string;
}
export declare const wikiCommand: (inputPath?: string, options?: WikiCommandOptions) => Promise<void>;
