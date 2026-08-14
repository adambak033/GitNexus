/**
 * Scope-resolution type definitions — RFC §2 data model (authoritative source).
 *
 * See: https://www.notion.so/346dc50b6ed281cfaacbe480bf231d50
 *
 * Anti-drift rule: every type, interface, and enum defined here is the single
 * source of truth. Later code that references these names must import them
 * from `gitnexus-shared`; it must not re-define them locally.
 *
 * Lifecycle contract (RFC §2.8): scopes are **constructed during extraction,
 * linked during finalize, immutable after finalize**. All fields are
 * `readonly` at the type level; `Object.freeze` is applied at runtime in dev
 * builds.
 *
 * Two structures are populated after freeze:
 *   1. `ReferenceIndex` — by resolution, before emission.
 *   2. `ScopeResolutionIndexes.bindingAugmentations` — the dedicated
 *      append-only post-finalize binding channel (e.g. C# same-namespace
 *      cross-file fanout). The companion `indexes.bindings` is the
 *      finalize-output channel and is deep-frozen by `materializeBindings`;
 *      walkers consult both via `lookupBindingsAt`. See `ScopeResolver`
 *      Invariant I8 for the full lifecycle contract.
 */
export {};
//# sourceMappingURL=types.js.map