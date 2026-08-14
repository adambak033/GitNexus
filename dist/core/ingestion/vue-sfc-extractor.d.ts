/**
 * Vue SFC (Single File Component) script extractor.
 *
 * Extracts the <script> / <script setup> block content from .vue files
 * so it can be parsed by the TypeScript tree-sitter grammar.
 *
 * Pure function — no tree-sitter dependency, safe for worker threads.
 */
export interface VueScriptExtraction {
    /** Extracted script content (TypeScript/JavaScript) */
    scriptContent: string;
    /** 1-based line number in the .vue file where the script content starts
     * (used as offset from tree-sitter's 0-based row). */
    lineOffset: number;
    /** true if at least one block is <script setup> */
    isSetup: boolean;
    /** Value of the `lang` attribute on the extracted script block (e.g. "ts", "js", "tsx", "jsx", or "" for default). */
    lang: string;
}
/**
 * Extract script content from a Vue SFC.
 *
 * When both <script> and <script setup> are present, the content of all
 * blocks is combined (non-setup first, then setup) so the full script
 * surface is available to the knowledge graph.
 */
export declare function extractVueScript(vueContent: string): VueScriptExtraction | null;
/**
 * Vue <script setup>: all top-level bindings are implicitly exported.
 * Returns true if the node (or any ancestor) has the `program` root as its
 * direct parent — i.e. the node is at the top level of the script block.
 *
 * Shared between the worker and sequential parsing paths.
 */
export declare const isVueSetupTopLevel: (node: {
    parent: {
        type: string;
        parent: unknown;
    } | null;
} | null) => boolean;
/**
 * Extract PascalCase component names used in <template>.
 * Returns deduplicated component names (e.g., ["MyButton", "AppHeader"]).
 */
export declare function extractTemplateComponents(vueContent: string): string[];
export interface ComponentEventBinding {
    /** PascalCase name of the child component element (e.g. `"PostList"`). */
    componentName: string;
    /** Vue event name without the `@` prefix (e.g. `"select"`, `"keyup.enter"`). */
    eventName: string;
    /** Bare identifier of the parent handler function (e.g. `"onPostSelected"`). */
    handlerName: string;
}
/**
 * Extract Vue component event bindings from a `<template>` block.
 *
 * Scans PascalCase component elements (e.g. `<PostList>`, `<UserCard>`) and
 * returns each `@event="handler"` binding found in the element's attribute
 * block. Native HTML element event handlers (`@click` on `<button>`, etc.)
 * are intentionally excluded — only component-to-component event bindings
 * that go through Vue's `emit()` / `defineEmits` system are included.
 *
 * **Limitation:** component tags whose attribute block spans multiple lines
 * and contains a `>` inside an attribute value are not captured (the regex
 * stops at the first `>`). Full template AST parsing would be required for
 * those edge cases (tracked in #1647).
 */
export declare function extractComponentEventBindings(vueContent: string): ComponentEventBinding[];
/**
 * Extract event handler names bound to native HTML elements in the template.
 *
 * Only processes lowercase-named elements (`<button>`, `<input>`, `<div>`,
 * etc.) — PascalCase component elements are handled by
 * `extractComponentEventBindings`. Returns bare handler identifiers only;
 * inline expressions with arguments or arrow functions are excluded.
 *
 * These handlers represent direct DOM-event→function relationships and
 * are emitted as `CALLS` edges (not `BINDS_EVENT_HANDLER`), because native
 * events are synchronous browser callbacks, not Vue's component-event system.
 */
export declare function extractNativeElementEventHandlers(vueContent: string): string[];
export interface ScriptEmitCall {
    /** Vue event name passed to `emit()` (e.g. `"action"`, `"update"`). */
    eventName: string;
}
export interface ExtractScriptEmitCallsOptions {
    /**
     * How to interpret the input text.
     * - `full-sfc` (default): input is a full `.vue` SFC string.
     * - `pre-extracted-script`: input is already the bare script text.
     */
    sourceKind?: 'full-sfc' | 'pre-extracted-script';
}
/**
 * Extract `emit('eventName', ...)` calls from a Vue SFC's `<script>` block.
 *
 * Scans the raw SFC source (full `.vue` file), extracts the script content,
 * then finds bare `emit('...')` calls. Only captures literal string event
 * names — dynamic expressions (`emit(eventName)`) are excluded.
 *
 * Returns deduplicated emit declarations.
 */
export declare function extractScriptEmitCalls(vueContent: string, options?: ExtractScriptEmitCallsOptions): ScriptEmitCall[];
/**
 * Extract variable identifiers from Vue template bound-attribute values.
 *
 * Covers `:prop="varName"` and `v-bind:prop="varName"` patterns where
 * the value is a single plain identifier.  Member-access expressions
 * (`:key="post.id"`) and literals are excluded by design.
 *
 * Returns deduplicated identifier names.
 */
export declare function extractTemplateAttributeBindings(vueContent: string): string[];
export interface VueTemplateEdgeData {
    /** PascalCase component names referenced in the template. */
    readonly templateComponents: readonly string[];
    /** Handler names on native elements (@click="fn"). */
    readonly nativeEventHandlers: readonly string[];
    /** Component event bindings (@event="handler" on component elements). */
    readonly componentEventBindings: readonly ComponentEventBinding[];
    /** Event names from emit() / this.$emit() calls in the script block. */
    readonly scriptEmitCalls: readonly ScriptEmitCall[];
    /** Bound attribute variable names (:prop="varName"). */
    readonly templateAttributeBindings: readonly string[];
}
/**
 * Extract all template-derived edge data from a Vue SFC in a single pass.
 *
 * Parses the `<template>` block once and the `<script>` block once, then
 * runs all five extractors on the pre-parsed content rather than repeating
 * the regex on every individual call.  Used by `emitPostResolutionEdges`
 * to avoid multiple full-file scans per `.vue` file.
 */
export declare function extractVueTemplateEdgeData(vueContent: string, options?: ExtractScriptEmitCallsOptions): VueTemplateEdgeData;
