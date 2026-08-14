/**
 * Generic-instantiation compatibility for interface-dispatch fan-out (#2912).
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────
 *
 * Heritage edges are stored between DECLARATIONS, and a declaration answers for
 * every instantiation of itself: `class UserValidator : IValidator<string>` and
 * `class IntValidator : IValidator<int>` both land in `IValidator`'s subtype
 * list, indistinguishable once the arguments are erased. A call through an
 * `IValidator<string>` receiver then fans out to `IntValidator.Check(int)` — a
 * target no runtime dispatch can produce, because the two instantiations are
 * unrelated types.
 *
 * ── THE MODEL ────────────────────────────────────────────────────────────────
 *
 * The subtype closure is walked carrying a SUBSTITUTION, exactly as a type
 * checker would. Each hop takes the arguments the supertype is currently known
 * to be instantiated with and the arguments the subtype WROTE on that supertype,
 * and unifies them positionally:
 *
 *   receiver `IValidator<string>`                        → super args ['string']
 *     `UserValidator : IValidator<string>`  ['string'] ≡ ['string']  → keep
 *     `IntValidator  : IValidator<int>`     ['int']     ✗             → prune
 *     `Wrapper<T>    : IValidator<T>`       ['T'] binds T = string   → keep,
 *          and the next hop sees `Wrapper` instantiated with ['string'], so
 *          `IntWrapper : Wrapper<int>` prunes and `StrWrapper : Wrapper<string>`
 *          survives.
 *
 * ── WHY EVERY UNCERTAINTY FAILS OPEN ─────────────────────────────────────────
 *
 * Dispatch fan-out is an over-approximation by design: a missing edge is a
 * silently wrong answer to "what can this call reach", while a surplus edge is
 * the pre-existing, documented imprecision. So this only ever prunes on POSITIVE
 * evidence that two instantiations differ, and returns `compatible` for every
 * shape it cannot decide — unknown arguments on either side, an arity it cannot
 * line up, or an argument that might be a type variable this pipeline did not
 * capture. `SymbolDefinition.typeParameters` and `ReferenceSite.typeArguments`
 * are both absent for languages whose captures do not populate them, and absence
 * means "unknown", never "not generic"; a language that captures neither is
 * therefore left with exactly the pre-#2912 fan-out.
 *
 * That is also why the arguments are RESOLVED rather than string-compared. Two
 * spellings that differ are only certainly different types when both bind to
 * something this pipeline can see — an imported `User` and a `Models.User` are
 * one type, and a lone `T` may be a type variable the capture layer never
 * recorded. The caller supplies the evidence (scope lookup + built-in names);
 * anything it cannot ground keeps the target.
 */
import type { TypeParameter } from '../../../../_shared/index.js';
/**
 * What a written type argument turned out to name, as far as the pipeline can
 * tell from where it was written.
 *
 * A spelling is GROUNDED when either field answers: it bound to a declaration,
 * or the language calls the name built in. Two grounded arguments that are not
 * the same type are the only evidence that licenses a prune. An ungrounded
 * spelling is `unknown` — it may be an external type, but it may equally be a
 * TYPE VARIABLE in a language whose captures do not record type parameters, and
 * pruning on that would delete `class Box<T> : IValidator<T>` from every
 * instantiation's fan-out.
 */
export interface GroundedTypeArgument {
    /** Identity of the declaration this spelling bound to, when it bound to one.
     *  Comparing identities rather than spellings is what makes `Models.User` and
     *  an imported `User` one type. */
    readonly definitionId?: string;
    /** The language declares this name built in (`string`, `int`). */
    readonly builtIn: boolean;
    /**
     * The name is a TYPE PARAMETER of a declaration enclosing where it was
     * written — the `T` of `void Run<T>(IValidator<T> v)` at the call site, or of
     * an outer class around a nested one's heritage clause.
     *
     * It stands for a different type at every instantiation, so it cannot be
     * compared with anything, and it must be recognised SEPARATELY from
     * ungrounded: a bounded `T extends User` grounds to its bound's declaration,
     * and comparing that bound against a concrete argument would prune every
     * implementor of a call written through `IValidator<T>`.
     */
    readonly typeVariable?: boolean;
}
/** Resolve a written type argument from the scope it was written in. */
type TypeArgumentResolver = (name: string) => GroundedTypeArgument;
/**
 * Generic arguments written on a heritage clause, keyed by the GRAPH-ID pair of
 * the edge they were written on — see {@link heritageTypeArgumentsKey}.
 *
 * Graph ids rather than def ids because that is the identity the heritage edge
 * itself carries, and because same-file partial declarations share one node: a
 * base listed on any part is the base of the whole type. Absent for every
 * non-generic base, for every language whose captures do not record arguments,
 * and for heritage that never passes through the inheritance pre-pass (Ruby's
 * `include`, Go's structural implements) — all of which read as "unknown".
 */
export type HeritageTypeArguments = ReadonlyMap<string, readonly string[]>;
/**
 * Records one heritage edge's instantiation, from whichever pass emitted that
 * edge — the generic inheritance pre-pass, or a language's own
 * `ScopeResolver.emitHeritageEdges` for heritage the pre-pass cannot express
 * (Rust `impl Trait for S`, Dart's `implements` markers).
 *
 * The ids MUST be the same pair the emitted edge carries, because the dispatch
 * walk looks the instantiation up by the edge it is crossing. Recording nothing
 * is always safe: absence reads as "unknown" and keeps every target.
 */
export type HeritageTypeArgumentSink = (subtypeGraphId: string, supertypeGraphId: string, typeArguments: readonly string[]) => void;
/** Key for {@link HeritageTypeArguments}. NUL-separated because a graph id
 *  embeds a file path, and a path may legally contain every other separator a
 *  reader would reach for first — `:`, `|`, even a space. */
export declare function heritageTypeArgumentsKey(subtypeGraphId: string, supertypeGraphId: string): string;
/** One hop of the subtype closure, expressed as a substitution problem. */
export interface HeritageInstantiationStep {
    /**
     * Arguments the SUPERTYPE is currently known to be instantiated with, in
     * declaration order — `['string']` for a receiver typed `IValidator<string>`.
     * `undefined` when the instantiation is unknown, which keeps every subtype.
     */
    readonly supertypeArguments: readonly string[] | undefined;
    /**
     * Arguments the SUBTYPE wrote on the supertype in its own heritage clause —
     * `['string']` for `: IValidator<string>`, `['T']` for `: IValidator<T>`.
     * `undefined` when the subtype named the supertype without arguments, or when
     * the language's captures did not record them.
     */
    readonly heritageArguments: readonly string[] | undefined;
    /** The SUBTYPE's own declared type parameters, in declaration order. */
    readonly subtypeParameters: readonly TypeParameter[] | undefined;
    /**
     * Does an EMPTY `subtypeParameters` mean "this declaration is not generic"?
     *
     * The distinction decides whether an unresolvable argument may be pruned on.
     * `SymbolDefinition.typeParameters` is absent both for a plain `class C :
     * IValidator<string>` and for every declaration in a language whose captures
     * record no parameters at all — and the two demand opposite answers, because
     * in the second case the `T` of `class Box<T> : IValidator<T>` is also absent
     * and would be read as a concrete type named "T".
     *
     * True when the caller has evidence the parameters ARE recorded: this
     * declaration itself lists some, or some declaration in the same language run
     * does. False leaves an unresolvable argument unusable as evidence, which is
     * the pre-#2912 fan-out for that language.
     */
    readonly subtypeParametersComplete: boolean;
    /** Ground a supertype argument — resolved from the RECEIVER's scope. */
    readonly resolveSupertypeArgument: TypeArgumentResolver;
    /** Ground a heritage argument — resolved from where the HERITAGE was written,
     *  a different scope from the call site and usually a different file. */
    readonly resolveHeritageArgument: TypeArgumentResolver;
    /** Optional language normalization applied to both sides before they are
     *  compared, for aliases that denote one type (C# `string` / `String`). */
    readonly normalize?: (name: string) => string;
}
interface HeritageInstantiationResult {
    /** False ONLY when the two instantiations are provably different types. */
    readonly compatible: boolean;
    /**
     * What the SUBTYPE is instantiated with, for the next hop of the walk:
     * its own type parameters resolved through this step's bindings. `undefined`
     * whenever any parameter stayed unbound — a partially known list would have to
     * be tracked per slot, and the whole-list unknown is the fail-open reading.
     */
    readonly subtypeArguments: readonly string[] | undefined;
}
/**
 * Unify one heritage hop and carry the substitution to the subtype.
 *
 * Pure and total: no lookups of its own, no throwing, and every branch it cannot
 * decide answers {@link UNKNOWN} — compatible, with an unknown instantiation.
 */
export declare function stepHeritageInstantiation(step: HeritageInstantiationStep): HeritageInstantiationResult;
export {};
