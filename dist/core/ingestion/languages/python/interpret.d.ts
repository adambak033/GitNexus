/**
 * Capture-match → semantic-shape interpreters.
 *
 * Two pure functions, both consumed by the central scope extractor:
 *
 *   - `interpretPythonImport`     → `ParsedImport`
 *   - `interpretPythonTypeBinding` → `ParsedTypeBinding`
 *
 * The matches arrive pre-decomposed by `emitPythonScopeCaptures`
 * (one imported name per match; synthesized `self`/`cls` markers
 * already attached) so these functions are straight-line tag readers.
 */
import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
export declare function interpretPythonImport(captures: CaptureMatch): ParsedImport | null;
export declare function interpretPythonTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
/**
 * Container bases whose SINGLE type argument is the element type.
 *
 * The single source of truth for both the matcher below and the property test
 * that asserts every one of them is also declined as a user generic — the two
 * lists drifting apart is the defect this arrangement exists to make
 * impossible. Order is significant only in that it is the regex alternation
 * order; keep additions grouped with their family.
 */
export declare const SINGLE_ARG_CONTAINERS: readonly string[];
/** Container bases whose SECOND type argument is the value type. See {@link SINGLE_ARG_CONTAINERS}. */
export declare const MAPPING_CONTAINERS: readonly string[];
/**
 * Bases a subscripted annotation may carry that are NOT user-defined generics.
 *
 * SCOPE — the standard library, and deliberately nothing else. The names below
 * are the documented Python type-system surface (`typing`'s deprecated PEP 585
 * aliases and its special forms, plus the stdlib classes those aliases point
 * at); that universe is CLOSED and versioned by CPython, so the list is
 * auditable against
 * <https://docs.python.org/3/library/typing.html#deprecated-aliases>.
 *
 * Third-party generics (`Mapped[int]`, `QuerySet[User]`) are NOT listed. That
 * universe is open, so enumerating it only ever chases the last escape, and
 * denying an ordinary name like `Model` would cost real edges in the many
 * projects that legitimately declare one. Those spellings still reduce to their
 * base, and the base is now admitted only on the grounds `resolveErasedBaseName`
 * applies at resolution time — the file's scope chain binds it, the declaration
 * is in this very file, the index proves the name is a template family, or the
 * file has no cross-file class channel to be absent from. A `Mapped[User]` whose
 * base the file cannot see therefore binds nothing, which is the structural
 * answer this parse-time pass cannot give and no longer has to.
 *
 * Two distinct reasons to decline, both always-correct at this layer:
 *   - CONTAINERS, including ones the two rules above do not own. Reducing
 *     `deque[User]` to `deque` types a receiver as the container and retargets
 *     every call in a for-loop chain, and reducing `dict[str, list[User]]` to
 *     `dict` destroys the value type the dict rule leaves for a downstream pass.
 *   - `typing` SPECIAL FORMS, which are not classes at all. `Callable`,
 *     `Literal`, `Union` reduce to a bare name that binds to a workspace class
 *     of that name if one exists — a fabricated edge.
 *
 * Members are listed ONCE per case-insensitive concept: {@link
 * isNotAUserGenericBase} folds case, so the builtin spelling covers its PEP 585
 * `typing` twin (`deque` covers `Deque`, `frozenset` covers `FrozenSet`).
 * Non-generic ABCs (`Hashable`, `Sized`) are omitted — they cannot be written
 * subscripted, so they never reach this branch.
 *
 * Exported for the property test that asserts the case-fold closure holds
 * behaviourally; nothing else should read it.
 */
export declare const NOT_A_USER_GENERIC_SPELLINGS: readonly string[];
