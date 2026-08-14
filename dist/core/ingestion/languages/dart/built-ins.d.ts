/**
 * Dart built-in / framework names whose calls the legacy DAG suppresses
 * (Flutter / Dart-SDK members not part of the indexed workspace). The
 * registry-primary capture walk skips emitting call references for these so
 * its CALLS graph matches the legacy DAG — which suppresses built-in-named
 * calls via `isBuiltInName` BEFORE resolution, for both free and member calls.
 *
 * Leaf module: shared by the provider (`builtInNames`) and `captures.ts`
 * without an import cycle (`dart.ts` → `dart/index.ts` → `captures.ts`).
 */
export declare const DART_BUILT_INS: ReadonlySet<string>;
