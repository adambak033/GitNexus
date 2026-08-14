/**
 * Swift `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed by
 * the generic `runScopeResolution` orchestrator (RFC #909 Ring 3,
 * issue #937 — the final per-language migration).
 *
 * Closest reference: C# (`csharpScopeResolver`) — both are OOP with
 * classes, structs, interfaces/protocols, and explicit instance
 * receivers. MRO follows Kotlin's shape (single superclass + multiple
 * protocol conformance).
 *
 * ## Swift specifics
 *
 *   - **Extensions** add members to an existing type. `emitSwiftScopeCaptures`
 *     re-keys an `extension Foo { … }` to a `class_declaration`-style def
 *     named `Foo`, so its members land on `Foo`'s scope and the shared
 *     `populateClassOwnedMembers` stamps them with `Foo`'s ownerId — the
 *     same mechanism C# uses for `partial class`. No separate hoist pass.
 *   - **Labeled arguments** narrow by ARITY only (count-primary, labels
 *     soft) — see `arity.ts`. Label-precise dispatch is deferred to the
 *     type-binding layer.
 *   - **Same-module visibility**: every file in an SPM target sees its
 *     siblings' top-level defs without an `import`. Modeled via
 *     `populateSwiftTargetSiblings`, grouped by the SPM target *subtree*
 *     (`Sources/<Target>/…`) via `groupSwiftFilesBySpmTarget` fed from the
 *     `loadResolutionConfig` SPM map, mirroring Go's package siblings. With
 *     no scanned source dir (no `Sources/`/`Package/Sources/`/`src/`) the
 *     map is null and all files form one `__default__` module.
 *   - **`super`** is the superclass receiver (`super.method()`); plain
 *     `self` is the instance receiver. Both synthesized in
 *     `receiver-binding.ts`.
 *
 * ## Known limitations (conscious migration trade-offs; parity gate flags
 * anything that matters in the corpus)
 *
 *   1. **Protocol associated types / generic constraints** (`extension
 *      Array where Element: Equatable`) are not narrowed — the `Self`
 *      type of a protocol method resolves to the protocol, not the
 *      conforming type.
 *   2. **Cross-module `import` resolution** is still directory-segment
 *      based (`import Foo` → files under a `Foo/` dir); explicit imports do
 *      not yet consult the SPM target map (follow-up, tracked under #1935).
 *      Same-target visibility (the common case) IS SPM-target-subtree
 *      accurate — handled by sibling augmentation grouped via
 *      `groupSwiftFilesBySpmTarget`, not by explicit imports.
 *   3. **Operator / subscript overloads** dispatch by name only.
 *   4. **`@_exported import` re-exports** are treated as plain imports.
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
declare const swiftScopeResolver: ScopeResolver;
export { swiftScopeResolver };
