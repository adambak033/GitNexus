/**
 * Kotlin capture-time side-channel serialization (#1983).
 *
 * `emitKotlinScopeCaptures` populates one MODULE-LEVEL, per-file map as a side
 * effect that is NOT part of the returned `ParsedFile`'s scopes/defs:
 *
 *   - `companionScopesByFile`  (companion-scopes.ts) — the `ScopeId`s that came
 *     from a `companion_object` AST node, recorded via `markCompanionScope`
 *     from the `@scope.companion` marker capture.
 *   - Spring Bean class-annotation facts collected during the same scope-query
 *     traversal, consumed only after imports and package visibility finalize.
 *   - Spring DI class facts (constructor/property/method injection syntax),
 *     resolved and attached only after imports finalize.
 *   - A JVM package fact read from the already-parsed root, so package-sibling
 *     visibility never re-parses Kotlin source on the main thread.
 *
 * On the worker path that map is filled in the WORKER process and lost across
 * the worker→main MessageChannel (and the disk-backed parsedfile-store),
 * because scope-resolution reuses the serialized `ParsedFile` and SKIPS the
 * main-thread re-extraction (the #1983 fix that avoids a main-thread
 * tree-sitter re-parse / OOM on huge repos). The main thread then reads the map
 * empty in `isKotlinStaticOnly` / `populateCompanionMembersOnEnclosingClass`
 * (owners.ts) — so companion methods aren't identified as static and
 * companion/static dispatch emits no CALLS edges.
 *
 * This module snapshots the per-file slice of that map into a plain,
 * JSON-serializable object (carried on `ParsedFile.captureSideChannel`) and
 * restores it on the main thread WITHOUT any parse. It mirrors the C++ pattern
 * in `cpp/capture-side-channel.ts`.
 *
 * The single generic `ParsedFile.captureSideChannel` field is shared with C++,
 * which is safe because each file is one language (a `.kt` file uses the kotlin
 * provider, a `.cpp` file the cpp provider). The payload is self-describing
 * (`{ kind: 'kotlin', companionScopes, packageFact, classAnnotations,
 * springDiFacts }`) so
 * `applyKotlinCaptureSideChannel` only restores kotlin state and ignores a
 * foreign-shaped snapshot.
 */
import type { ParsedFile, ScopeId } from '../../../../_shared/index.js';
import { type ClassAnnotationFact } from '../../frameworks/spring/bean-candidates.js';
import { type JvmPackageFact } from '../jvm/package-facts.js';
import type { KotlinSpringAopFact } from './spring-aop.js';
import type { KotlinSpringConditionalFact } from './spring-conditionals.js';
import type { KotlinSpringDiClassFact } from './spring-di.js';
/**
 * Plain JSON-serializable snapshot of the per-file Kotlin capture-time
 * side-channel. Carried opaquely on `ParsedFile.captureSideChannel`. The
 * `kind` tag makes the payload self-describing so `apply` can distinguish a
 * kotlin snapshot from another language's (C++ shares the same field).
 */
export interface KotlinCaptureSideChannel {
    readonly kind: 'kotlin';
    /** Companion-object scope ids recorded for this file. */
    readonly companionScopes: readonly ScopeId[];
    /** Package visibility captured from the existing Kotlin AST. */
    readonly packageFact: JvmPackageFact;
    /** Class annotation syntax collected by the existing scope traversal. */
    readonly classAnnotations: readonly ClassAnnotationFact[];
    /** Spring proxy/advice syntax captured per class or callable owner. */
    readonly springAopFacts?: readonly KotlinSpringAopFact[];
    /** Profile, conditional, and auto-configuration syntax captured per owner. */
    readonly springConditionalFacts?: readonly KotlinSpringConditionalFact[];
    /** Constructor, property, and method injection syntax captured per class. */
    readonly springDiFacts?: readonly KotlinSpringDiClassFact[];
}
export declare function clearKotlinClassAnnotationFacts(): void;
export declare function setKotlinSpringAopFacts(filePath: string, facts: readonly KotlinSpringAopFact[]): void;
export declare function getKotlinSpringAopFacts(filePath: string): readonly KotlinSpringAopFact[];
export declare function setKotlinClassAnnotationFacts(filePath: string, facts: readonly ClassAnnotationFact[]): void;
export declare function getKotlinClassAnnotationFacts(filePath: string): readonly ClassAnnotationFact[];
export declare function setKotlinSpringConditionalFacts(filePath: string, facts: readonly KotlinSpringConditionalFact[]): void;
export declare function getKotlinSpringConditionalFacts(filePath: string): readonly KotlinSpringConditionalFact[];
export declare function setKotlinSpringDiFacts(filePath: string, facts: readonly KotlinSpringDiClassFact[]): void;
export declare function getKotlinSpringDiFacts(filePath: string): readonly KotlinSpringDiClassFact[];
/**
 * `LanguageProvider.collectCaptureSideChannel` implementation for Kotlin.
 * Returns `undefined` when this file recorded no side-channel state at all, so
 * the produced `ParsedFile` carries the field only when there's data to ship.
 */
export declare function collectKotlinCaptureSideChannel(filePath: string): KotlinCaptureSideChannel | undefined;
/**
 * `ScopeResolver.applyCaptureSideChannel` implementation for Kotlin. Reads the
 * worker-serialized snapshot from `parsed.captureSideChannel` and re-populates
 * the module-level companion-scope map via `markCompanionScope`. Tolerant of
 * `undefined` (file carried no data) and of an unexpected / foreign shape
 * (defensive — the `kind` tag guards against restoring a non-kotlin payload).
 * Does NO tree-sitter parse.
 */
export declare function applyKotlinCaptureSideChannel(parsed: ParsedFile): void;
