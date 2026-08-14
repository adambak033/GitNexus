// Schema constants
export { NODE_TABLES, REL_TABLE_NAME, REL_TYPES, EMBEDDING_TABLE_NAME, } from './lbug/schema-constants.js';
// Language support
export { SupportedLanguages } from './languages.js';
export { getLanguageFromFilename, getSyntaxLanguageFromFilename, isBladeTemplateFilename, } from './language-detection.js';
// Evidence + tie-break constants (RFC Appendix A, Appendix B)
export { EvidenceWeights, typeBindingWeightAtDepth } from './scope-resolution/evidence-weights.js';
export { ORIGIN_PRIORITY } from './scope-resolution/origin-priority.js';
// Language classification (RFC §6.1 Ring 3/4 governance)
export { LanguageClassifications, isProductionLanguage, } from './scope-resolution/language-classification.js';
// Core indexes over per-file artifacts (RFC §3.1; Ring 2 SHARED #913)
export { buildDefIndex } from './scope-resolution/def-index.js';
export { buildModuleScopeIndex } from './scope-resolution/module-scope-index.js';
export { buildQualifiedNameIndex } from './scope-resolution/qualified-name-index.js';
// Strict type-reference resolver (RFC §4.6; Ring 2 SHARED #916)
// `ScopeLookup` is defined in `./scope-resolution/types.js` and exported
// from the type-export block above — not from this module.
export { resolveTypeRef } from './scope-resolution/resolve-type-ref.js';
// Method-dispatch materialized view over HeritageMap (RFC §3.1; Ring 2 SHARED #914)
export { buildMethodDispatchIndex } from './scope-resolution/method-dispatch-index.js';
// SCC-aware cross-file finalize (RFC §3.2 Phase 2; Ring 2 SHARED #915)
export { finalize } from './scope-resolution/finalize-algorithm.js';
// Scope-aware registries + 7-step lookup (RFC §4; Ring 2 SHARED #917)
export { buildClassRegistry } from './scope-resolution/registries/class-registry.js';
export { buildMethodRegistry } from './scope-resolution/registries/method-registry.js';
export { buildFieldRegistry } from './scope-resolution/registries/field-registry.js';
export { buildMacroRegistry } from './scope-resolution/registries/macro-registry.js';
export { lookupCore } from './scope-resolution/registries/lookup-core.js';
export { lookupQualified } from './scope-resolution/registries/lookup-qualified.js';
export { composeEvidence, confidenceFromEvidence } from './scope-resolution/registries/evidence.js';
export { compareByConfidenceWithTiebreaks, CONFIDENCE_EPSILON, } from './scope-resolution/registries/tie-breaks.js';
export { CLASS_KINDS, METHOD_KINDS, FIELD_KINDS, MACRO_KINDS, } from './scope-resolution/registries/context.js';
// Scope tree spine + position lookup (RFC §2.2 + §3.1; Ring 2 SHARED #912)
export { makeScopeId, clearScopeIdInternPool } from './scope-resolution/scope-id.js';
export { buildScopeTree, canParentScope, ScopeTreeInvariantError, } from './scope-resolution/scope-tree.js';
export { buildPositionIndex } from './scope-resolution/position-index.js';
// Resilient fetch primitives — bounded retries + per-process circuit breaker.
// Test-only helpers (`__resetBreakerRegistry__`, `classifyOutcome`) are
// reachable via the separate `gitnexus-shared/test-helpers` subpath; do
// NOT add them here. Production consumers must not call them.
export { withRetry, computeBackoffMs } from './integrations/retry.js';
export { CircuitBreaker, CircuitOpenError, getBreaker } from './integrations/circuit-breaker.js';
export { resilientFetch, ResilientFetchExhaustedError, RETRY_AFTER_CAP_MS, parseRetryAfter, isTerminalNetworkError, } from './integrations/resilient-fetch.js';
// Understand-Quickly registry integration (opt-in)
export { UNDERSTAND_QUICKLY_DISPATCH_URL, UNDERSTAND_QUICKLY_EVENT_TYPE, UNDERSTAND_QUICKLY_TOKEN_ENV, buildUqDispatchPayload, isValidOwnerRepo, parseOwnerRepoFromRemote, stripGitSuffix, } from './integrations/understand-quickly.js';
//# sourceMappingURL=index.js.map