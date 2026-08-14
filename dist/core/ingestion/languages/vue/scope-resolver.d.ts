/**
 * Vue `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed by
 * the generic `runScopeResolution` orchestrator (RFC #909 Ring 3, issue #940).
 *
 * ## Design rationale
 *
 * Vue SFCs compile down to TypeScript/JavaScript — the `<script>` /
 * `<script setup>` block is pure TS/JS, parsed with the TypeScript
 * grammar and captured by `emitVueScopeCaptures` (which delegates
 * to `emitTsScopeCaptures`).  Because of this, nearly all hooks are
 * identical to the TypeScript resolver:
 *
 *   - `mergeBindings` — TypeScript LEGB semantics apply in script blocks.
 *   - `arityCompatibility` — same positional + rest rules.
 *   - `buildMro` / `populateOwners` — shared with TypeScript.
 *   - `isSuperReceiver` — `super(...)` / `super.foo` / `super[x]` pattern.
 *   - `resolveImportTarget` — TypeScript resolver with `.vue` explicit-
 *                             extension support; tsconfig paths loaded via
 *                             `loadResolutionConfig`.
 *
 * ## Key differences from TypeScript
 *
 *   - `language: SupportedLanguages.Vue` — routes the resolver to Vue
 *     files only; TypeScript files use the TypeScript resolver.
 *   - `languageProvider: vueProvider` — the Vue-specific language
 *     provider supplies the right built-ins and export checker for
 *     `<script setup>` (all top-level bindings implicitly exported).
 *   - `importEdgeReason: 'vue-scope: import'` — distinct tag for
 *     debugging / edge provenance.
 *   - `allowGlobalFreeCallFallback: false` — Vue uses explicit imports;
 *     workspace-wide unique-name fallback is unnecessary and would
 *     produce spurious edges for Vue built-ins (ref, reactive, …).
 *
 * ## Options API / this-binding
 *
 * Options API (`defineComponent({ methods: { … } })`) stores methods
 * on the component instance, which tree-sitter sees as object property
 * values.  `this.X()` inside a method resolves via the existing
 * `tsReceiverBinding` hook (inherited from TypeScript), which walks to
 * the enclosing Class scope.  For Options API the enclosing "class" is
 * the `defineComponent({…})` object — not a true class — so `this`
 * calls may not resolve through the type-binding layer.  `fieldFallbackOnMethodLookup`
 * is therefore set to `true` so the field-name fallback catches common
 * patterns even without an explicit type annotation.
 *
 * ## `<script setup>` macro calls
 *
 * `defineProps`, `defineEmits`, `defineExpose`, `withDefaults`, etc.
 * are compiler macros available as globals inside `<script setup>`.
 * They are listed in `vueProvider.builtInNames` and therefore treated
 * as resolved without requiring an import edge.
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
declare const vueScopeResolver: ScopeResolver;
export { vueScopeResolver };
