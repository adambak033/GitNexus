import type { HttpLanguagePlugin } from './types.js';
/**
 * The exported plugin is `null` when tree-sitter-kotlin's native
 * binding is unavailable. `http-patterns/index.ts` checks for null
 * before registering `.kt`/`.kts` so missing optional grammars never
 * crash the orchestrator.
 */
export declare const KOTLIN_HTTP_PLUGIN: HttpLanguagePlugin | null;
