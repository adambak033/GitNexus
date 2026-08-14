/**
 * The DI resolver contract — the types a per-language/per-framework resolver
 * implements and the shared `di` pipeline phase consumes.
 *
 * A leaf module by design: it imports nothing from this directory, so the
 * barrel (`./index.ts`, which aggregates the resolver *implementations*) and
 * each implementation (`./spring.ts`) can both depend on the contract without
 * depending on each other. The barrel re-exports the two MATCH types, because
 * consumers of the registry read them off its results; `DiResolver` is not
 * re-exported, since only implementations need it and they import it from here
 * directly.
 *
 * Mirrors the `import-resolvers/types.ts` split of contract from registry.
 */
export {};
