/**
 * Spring dependency-injection field matcher for the generic `di` phase.
 *
 * Recognizes the fields Spring's container fills via collect-all-implementers
 * collection injection: when a Java class declares a field carrying an
 * injection annotation (`@Autowired` or `@Inject`) typed as `List<T>`,
 * `Set<T>`, `Collection<T>`, or `Map<K,T>`, the container injects EVERY bean
 * implementing interface `T`. The matcher reports the element type name `T`
 * plus a human-readable reason naming the collection wrapper and the
 * annotation that gated the match; the shared `di` phase turns that into
 * `INJECTS` edges.
 *
 * The injection annotation is a hard precondition: a plain (non-annotated)
 * collection field is never injected by the container and produces no match.
 * `@Resource` (JSR-250) is DELIBERATELY excluded: it resolves by bean NAME
 * first (defaulting to the field name), which injects a single named
 * collection bean — the opposite of the collect-all-implementers fan-out
 * INJECTS models. Including it would emit false edges.
 *
 * Matching happens on `rawDeclaredType` (the verbatim type text, generics
 * preserved) — NOT `declaredType`, which is generics-stripped by design
 * (`List<Shape>` → `List`) and can never match the collection patterns.
 *
 * Accepted type shapes (after whitespace normalization — internal runs of
 * whitespace, including newlines from multi-line declarations, collapse to a
 * single space):
 * - `List<T>` / `Set<T>` / `Collection<T>` — element `T`.
 * - `Map<K, T>` — element is the VALUE type `T`; the key `K` is irrelevant
 *   for DI resolution and may itself be generic (`Map<Pair<A,B>, T>` — the
 *   top-level-comma split is bracket-depth-aware, so nested commas in the
 *   key never bleed into the element).
 * - Bounded wildcards `List<? extends T>` / `List<? super T>` — element `T`
 *   (both are idiomatic Spring collection injection; the container still
 *   collects every implementer of `T`).
 * - Package-qualified wrappers `java.util.List<T>` — the wrapper is
 *   recognized by its LAST dotted segment. The ELEMENT keeps its dots
 *   (`List<com.a.Shape>` → `com.a.Shape`): dotted element names resolve via
 *   `qualifiedName` downstream in the `di` phase.
 *
 * Documented REJECTIONS (parse returns `null` — no INJECTS edges):
 * - `Map<String, List<IFoo>>` — the element itself is generic; a nested
 *   generic is not resolvable as a single interface.
 * - `List<?>` — unbounded wildcard; there is no element type to fan out to.
 * - Arrays: `IFoo[]`, `List<IFoo>[]`, `List<IFoo[]>` — array injection is
 *   not the collect-all-implementers shape INJECTS models.
 * - Non-collection types (`IFoo`, `Optional<IFoo>`, …) and wrong generic
 *   arity (`Map<String>`, `List<A, B>`).
 * - Anything whose element is not a plain (possibly dotted) Java type name —
 *   this makes the parser fail closed on unanticipated syntax. In particular
 *   Java block comments inside the generic arguments (a `/* ... ` comment
 *   between `<` and the element) are NOT stripped and fail closed —
 *   acceptable.
 *
 * Registered for Java and Kotlin in `./index.ts` (`DI_RESOLVERS`); language
 * routing is the registry's job, so the matcher itself never reads
 * `node.properties.language`. Kotlin's AST-backed class metadata is the
 * primary path because Kotlin Property extraction intentionally exposes less
 * annotation/type syntax than Java's legacy field contract.
 */
import type { GraphNode } from '../../../_shared/index.js';
import type { DiResolver } from './types.js';
/** Ephemeral Class-node property populated by Java's post-resolution Spring
 * metadata hook. It is consumed in the same pipeline run before persistence. */
export declare const SPRING_DI_INJECTION_SITES_PROPERTY = "springDiInjectionSites";
/** Ephemeral Class-node property carrying Spring bean names / @Primary. */
export declare const SPRING_DI_PROVIDER_PROPERTY = "springDiProvider";
/** Marker placed on Property nodes whose richer AST-backed field fact was
 * attached to the owning Class, suppressing the legacy collection fallback. */
export declare const SPRING_DI_CAPTURED_FIELD_PROPERTY = "springDiCapturedField";
/**
 * Parse a Spring DI collection field's raw declared type (verbatim source
 * text, generics preserved) and return the injected bean type name.
 *
 * Whitespace-normalizes first (raw tree-sitter `.text` can span lines), then
 * recognizes the wrapper by the LAST dotted segment before the first `<`
 * (so `java.util.List<IFoo>` works), depth-aware-splits the generic argument
 * list, and validates the element position. See the module docstring for the
 * full accepted/rejected shape inventory.
 *
 * @returns the collection wrapper name + element type name, or `null` when
 *          the raw declared type is not a recognized Spring collection shape.
 */
export declare function parseSpringCollectionType(rawDeclaredType: string): {
    collectionType: string;
    elementTypeName: string;
} | null;
/** Parse either a supported collect-all type or a standard single bean type. */
export declare function parseSpringInjectionType(rawDeclaredType: string): {
    targetTypeName: string;
    cardinality: 'single' | 'collection';
    displayType: string;
} | null;
/**
 * Match a `Property` node against Spring's collection-injection shape.
 *
 * Returns the parsed match (with a Spring-specific human-readable `reason`
 * payload) or `null` when the field is not container-injected.
 */
export declare const springDiFieldMatcher: (node: GraphNode) => {
    elementTypeName: string;
    reason: string;
} | null;
/** JVM/Spring resolver registered behind the framework-neutral DI seam. */
export declare const springDiResolver: DiResolver;
