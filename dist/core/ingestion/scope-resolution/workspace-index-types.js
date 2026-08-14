/**
 * The shape of `WorkspaceResolutionIndex` — the scope-tied lookup tables built
 * once per resolution run.
 *
 * A leaf module by design: it imports nothing from this package, so
 * `scope/walkers.ts` can type its `index` parameters against the contract
 * without importing the builder module that itself calls into `walkers.ts`.
 * `./workspace-index.ts` re-exports this type, so consumers may keep importing
 * `WorkspaceResolutionIndex` alongside `buildWorkspaceResolutionIndex` from
 * there.
 *
 * See `./workspace-index.ts` for what belongs in this index versus what belongs
 * on `SemanticModel`, and for the builder itself.
 */
export {};
