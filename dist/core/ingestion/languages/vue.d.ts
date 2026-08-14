/**
 * Vue language provider.
 *
 * Vue SFCs are preprocessed by extracting the <script> / <script setup>
 * block content, which is then parsed as TypeScript. This provider reuses
 * nearly all TypeScript infrastructure — queries, type config, field
 * extraction, and named binding extraction.
 *
 * Export detection for <script setup> is handled directly in the parse
 * worker (all top-level bindings are implicitly exported). The export
 * checker here is used as fallback for non-setup <script> blocks.
 */
export declare const vueProvider: import("../language-provider.js").LanguageProvider;
