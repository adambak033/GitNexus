import type Parser from 'tree-sitter';
import type { Capture, NodeLabel, Range } from '../../../_shared/index.js';
import type { LanguageProvider } from '../language-provider.js';
/** Tree-sitter AST node. Re-exported for use across ingestion modules. */
export type SyntaxNode = Parser.SyntaxNode;
/**
 * Qualify a name by its enclosing `mod_item` scope, so two same-tail items nested
 * under different modules get DISTINCT paths (`outer.Inner` vs `other.Inner`).
 * Walks `mod_item` ancestors (outermost → innermost) and joins them with the
 * normalized raw text via the shared `splitQualifiedName`. Keyed purely on
 * tree-sitter node types (no language name), so it is a no-op for every grammar
 * without such a node.
 *
 * TWO callers, with different contracts — read both before widening either:
 *
 *  1. The inherent-impl target (`impl Inner { … }`) — the #1982 follow-up to
 *     #1975, reachable through the {@link qualifyRustImplTargetByModScope} alias
 *     and mirrored by the inherent-impl branch in `findEnclosingClassInfo` so the
 *     owner edge and the node id agree byte-for-byte. That caller gates on an
 *     UNSCOPED `type_identifier`, which is what keeps a SCOPED `impl a::Inner` on
 *     its full raw text.
 *
 *  2. Free items, for module node identity (#2742). That caller gates on the node
 *     being on neither side of an owner edge (`MEMBER_OWNER_NODE_TYPES`,
 *     `enclosingClassInfo`) and not inside a callable, because only the id moves
 *     here — every owner-edge anchor is minted separately and does not follow.
 *
 * A name with NO enclosing `mod` is returned verbatim, never normalized: rewriting
 * a scoped target's separator (`a::Inner` → `a.Inner`) would move its node id away
 * from the id its owner edge emits, which is how caller 2 first broke caller 1's
 * #1975 contract. Splitting an unscoped name has always been the identity, so
 * caller 1 is unaffected either way.
 */
export declare const qualifyByEnclosingModScope: (node: SyntaxNode, rawText: string) => string;
/**
 * Impl-target alias of {@link qualifyByEnclosingModScope}, kept as its own name
 * because the caller gates it on UNSCOPED targets (see the contract above).
 */
export declare const qualifyRustImplTargetByModScope: (node: SyntaxNode, rawText: string) => string;
/**
 * #1991: scope-label predicate that single-sources the `nodeLabel === 'Trait'`
 * checks in parsing-processor.ts / parse-worker.ts. A Ruby `module` maps to the
 * `Trait` registry label but is NOT a typeDeclaration, so `extractQualifiedName`
 * bails on it; these node labels are instead qualified via the scope walk
 * (`qualifyScopeName`) so same-tail nested modules get distinct ids. Keeping the
 * literal in one place stops the four hand-maintained copies (two each in the
 * sequential and worker definition paths) from drifting apart. Pure predicate —
 * value-identical to the inlined `nodeLabel === 'Trait'`.
 */
export declare const isQualifiableScopeLabel: (nodeLabel: string) => boolean;
/**
 * Ordered list of definition capture keys for tree-sitter query matches.
 * Used to extract the definition node from a capture map.
 */
export declare const DEFINITION_CAPTURE_KEYS: readonly ["definition.function", "definition.class", "definition.interface", "definition.method", "definition.struct", "definition.enum", "definition.namespace", "definition.module", "definition.trait", "definition.impl", "definition.type", "definition.const", "definition.static", "definition.variable", "definition.typedef", "definition.macro", "definition.union", "definition.property", "definition.record", "definition.delegate", "definition.annotation", "definition.constructor", "definition.template"];
/** Extract the definition node from a tree-sitter query capture map. */
export declare const getDefinitionNodeFromCaptures: (captureMap: Record<string, SyntaxNode | undefined>) => SyntaxNode | null;
type QueryMatchLike = {
    captures: Array<{
        name: string;
        node: SyntaxNode;
    }>;
};
export declare const isSuppressedConcreteTypedefDuplicate: (captureMap: Record<string, SyntaxNode>, concreteTypedefRanges: ReadonlySet<string>) => boolean;
/** True when `label` is the kind of node a value capture emits. */
export declare const isValueDefinitionLabel: (label: NodeLabel) => boolean;
/**
 * One pass over a file's matches: definition-name claims by rank, plus the
 * concrete-typedef ranges the loop's separate typedef guard consumes.
 */
export interface DefinitionPreScan {
    /**
     * Keys claimed by any non-value capture — consulted by `Const`/`Static`/
     * `Variable`. Includes `Property`, so an annotated Python attribute still
     * beats the bare-assignment `Variable` capture on the same statement.
     */
    readonly nonValue: ReadonlySet<string>;
    /**
     * Keys claimed by a *callable* capture (`Function`/`Method`/`Constructor`) —
     * consulted by `Property`. Narrower than `nonValue` on purpose: a `Property`
     * must be collapsible by a callable (Kotlin `val f = { … }`, Swift
     * `let f = { … }`) without being collapsible by its own claim.
     */
    readonly callable: ReadonlySet<string>;
    /** Ranges of `type_definition` nodes that already emit a concrete struct/enum. */
    readonly concreteTypedefRanges: ReadonlySet<string>;
}
/**
 * Pre-scan `matches` for the `${definitionNode.startIndex}:${name}` keys already
 * claimed by a higher-ranked definition capture, so the parse-worker's duplicate
 * suppression is order-independent.
 *
 * Rank, highest first: callable (`Function`/`Method`/`Constructor`) → `Property`
 * → value (`Const`/`Static`/`Variable`). A capture is dropped only when a
 * STRICTLY higher rank claimed the same declaration node and name, so no capture
 * can suppress itself and no rank can suppress a peer.
 *
 * ## Why this exists (#2687)
 *
 * `const X = () => {}` matches BOTH `@definition.function` and
 * `@definition.const` on the same `lexical_declaration`. Only one graph node
 * should survive — the `Function`, because that is what `CALLS` edges target.
 * The parse-worker's in-loop dedup intends exactly that, but only the value
 * branch consults its `processedDefinitionNodes` set, so suppression worked only
 * if the function match happened to be processed first. It is not: tree-sitter
 * completes the const pattern at `@name`, while the function pattern must also
 * match the trailing `(arrow_function)` / `(function_expression)` value, so the
 * const match is yielded FIRST and the edgeless `Const:` twin escaped.
 *
 * Consulting this set makes the outcome independent of match order.
 *
 * ## Keying
 *
 * Keys are `startIndex:name`, never `startIndex` alone — a multi-name
 * declaration (`const a = 1, b = () => {}`) shares ONE definition node, and a
 * bare-index key would wrongly suppress `a`'s legitimate `Const` node.
 *
 * Labels come from {@link getLabelFromCaptures}, the same function the main loop
 * uses, so the pre-scan and the loop can never disagree about what counts as a
 * value capture — including when a provider's `labelOverride` reclassifies one.
 * A match that resolves to a value label registers nothing, so a match can never
 * suppress itself.
 *
 * Language-agnostic: keyed off capture names and labels only.
 *
 * Also collects the concrete-typedef ranges that suppress the analogous
 * typedef/struct duplicate, so both suppression sets come from one traversal.
 */
export declare const buildDefinitionPreScan: (matches: readonly QueryMatchLike[], provider: LanguageProvider) => DefinitionPreScan;
/**
 * Node types that represent function/method definitions across languages.
 * Used by parent-walk in call-processor, parse-worker, and type-env to detect
 * enclosing function scope boundaries.
 *
 * INVARIANT: This set MUST be a superset of every language's
 * MethodExtractionConfig.methodNodeTypes. When adding a new node type to a
 * MethodExtractor config, add it here too — otherwise enclosing-function
 * resolution will silently miss that node type during parent-walks.
 */
export declare const FUNCTION_NODE_TYPES: Set<string>;
/**
 * AST node types that represent a class-like container (for HAS_METHOD edge extraction).
 *
 * INVARIANT: When a language config adds a new node type to `typeDeclarationNodes`,
 * that type must also be added here AND to `CONTAINER_TYPE_TO_LABEL` below,
 * otherwise `findEnclosingClassNode` won't recognize it and methods may get
 * orphaned HAS_METHOD edges or incorrect labels.
 */
export declare const CLASS_CONTAINER_TYPES: Set<string>;
/**
 * Node types whose OWN node id must not be re-keyed by an enclosing-scope
 * qualifier (see {@link qualifyByEnclosingModScope}) unless the owner-edge
 * anchor moves in the same change.
 *
 * These are the containers a member can be declared inside. Their members'
 * `HAS_METHOD` / `HAS_PROPERTY` edges anchor on `findEnclosingClassInfo().classId`,
 * which is minted from the container's bare `nameNode.text` further down this
 * file and only follows a qualified shape when the provider opts in via
 * `classExtractor.qualifiedNodeId`. So qualifying a container's id alone points
 * every one of its member edges at a node that does not exist — the edges are
 * dropped at COPY time and the container silently loses all its members.
 *
 * Derived from `CLASS_CONTAINER_TYPES` on purpose: that set is already the
 * single source of "this node type owns member edges", carries the INVARIANT
 * note above binding it to `CONTAINER_TYPE_TO_LABEL`, and so a language adding
 * a container cannot gain a mismatched id shape here without also failing that
 * invariant. Keyed purely on tree-sitter node types — no language names.
 */
export declare const MEMBER_OWNER_NODE_TYPES: ReadonlySet<string>;
export declare const CONTAINER_TYPE_TO_LABEL: Record<string, string>;
/**
 * Pre-order walk over a node and all its named descendants, invoking `cb` on
 * each. Replaces the per-language `visit`/`visitGo`/`visitRust`/`visitSwift`
 * clones that every language's capture-synthesis walker re-implemented (#1956
 * tri-review U6).
 *
 * Iterates by index with a null guard: `node.namedChild(i)` is typed
 * `SyntaxNode | null`, and most callers already guarded it. The Go and C#
 * callers previously iterated `node.namedChildren`; the Go one had no null
 * guard, so this standardizes them onto the guarded indexed form — a deliberate,
 * strictly-safer behavior addition (the traversal *sequence* is identical, so
 * capture output stays byte-identical on well-formed trees; the guard only
 * matters for a null named child, which the fixture corpus never produces).
 */
export declare function walkNamedTree(node: SyntaxNode, cb: (node: SyntaxNode) => void): void;
/** Return the first matching ancestor unless a boundary ancestor is reached first. */
export declare function findAncestorBeforeBoundary(node: SyntaxNode, targetTypes: ReadonlySet<string>, boundaryTypes: ReadonlySet<string>): SyntaxNode | null;
/**
 * Enclosing callable for grammars that split a callable into a SIGNATURE node
 * and a SIBLING body, where the callable is therefore never an ancestor of the
 * code inside it.
 *
 * Dart is the case that forced this: `int outer() { … }` parses as
 * `function_signature` followed by `function_body` as SIBLINGS, so an ancestor
 * walk from a closure inside the body can never reach `outer`. No membership
 * set fixes that — the walk is looking in the wrong direction (#2699).
 *
 * Deliberately a FALLBACK, used only when the ancestor walk found nothing.
 *
 * The sibling must be a BARE SIGNATURE, and that restriction is load-bearing —
 * "any preceding callable sibling" is WRONG and was caught regressing PHP. In
 * `<?php function target($x) {…} $handler = function ($x) {…};` the closure is
 * at FILE level, so the primary ancestor walk correctly finds nothing and this
 * fallback runs; an unrestricted version then grabs the preceding
 * `function_definition` and mis-qualifies the file-level `$handler` as
 * `target.$handler`. A preceding sibling is only an ENCLOSING callable when it
 * cannot hold its own body — i.e. when the grammar split the body off.
 *
 * `SPLIT_SIGNATURE_NODE_TYPES` is exactly that set, and it is derived rather
 * than listed: `LOCAL_SCOPE_BODY_NODE_TYPES` already filters the bare-signature
 * types out of `FUNCTION_NODE_TYPES`, so the difference between them IS the
 * split-signature set. PHP's `function_definition` carries a body and is in
 * both, so it is excluded; Dart's `function_signature` is in only the former,
 * so it qualifies.
 *
 * Language-neutral by construction — it names no grammar, and any future
 * signature/body-split language is covered for free.
 */
export declare function findSplitBodyCallableAncestor(node: SyntaxNode, signatureOnlyTypes: ReadonlySet<string>, boundaryTypes: ReadonlySet<string>): SyntaxNode | null;
/**
 * Determine the graph node label from a tree-sitter capture map.
 * Handles language-specific reclassification via the provider's labelOverride hook
 * (e.g. C/C++ duplicate skipping, Kotlin Method promotion).
 * Returns null if the capture should be skipped (import, call, C/C++ duplicate, missing name).
 */
export declare function getLabelFromCaptures(captureMap: Record<string, SyntaxNode | undefined>, provider: LanguageProvider): NodeLabel | null;
/** Enclosing class info: both the generated node ID and the bare class name. */
export interface EnclosingClassInfo {
    classId: string;
    className: string;
    /**
     * The owner node id keyed by the enclosing type's FULLY-QUALIFIED path
     * (e.g. "Class:file:Outer.Inner"), present only when the language opts into
     * `qualifiedNodeId` AND the enclosing type is actually nested (#1978).
     * Consumers building HAS_METHOD/HAS_PROPERTY owner edges use this in
     * preference to `classId` so the edge source matches the qualified class
     * node id. When absent, `classId` (the simple-tail key) is unchanged.
     */
    qualifiedClassId?: string;
}
/**
 * GitNexus's source-type-relative Java identity for local and anonymous
 * types. It follows javac's `$N` allocation but intentionally omits the
 * package prefix because graph ids already include the source file path.
 */
export interface JavaSynthesizedTypeIdentity {
    readonly name: string;
    readonly label: 'Class' | 'Enum' | 'Record' | 'Interface';
    readonly bindingName?: string;
}
/** A legal local type declaration is a class, enum, record, or interface
 * directly occupying a block-statement position. Annotation interfaces are
 * deliberately excluded: javac rejects local annotation declarations. */
export declare const javaLocalTypeDeclarationContainer: (node: SyntaxNode) => SyntaxNode | null;
/**
 * Authoritative Java local/anonymous type identity.
 *
 * JLS 13.1 defines the shape and immediate-host prefix. OpenJDK javac's
 * Check.localClassName allocates N independently for each
 * (enclosing binary name, local simple name) pair; anonymous types use the
 * empty simple name and therefore have their own sequence. Package names are
 * omitted from this project identity because graph ids already include the
 * file path.
 */
export declare const synthesizeJavaTypeIdentity: (node: SyntaxNode) => JavaSynthesizedTypeIdentity | undefined;
export declare const findEnclosingClassInfo: (node: SyntaxNode, filePath: string, resolveEnclosingOwner?: (node: SyntaxNode) => SyntaxNode | null, 
/**
 * Optional (#1978): returns the enclosing type's fully-qualified name
 * (e.g. "Outer.Inner") for a type-declaration container, or null. Callers
 * pass `classExtractor.extractQualifiedName` ONLY when the language's
 * `qualifiedNodeId` flag is on — so when omitted, behavior is byte-identical
 * to before (qualifiedClassId stays undefined). Used by the standard
 * class-container branch to compute `qualifiedClassId` from the SAME function
 * the node-id is built from, guaranteeing owner-id == node-id by construction.
 */
getQualifiedOwnerName?: (node: SyntaxNode, simpleName: string) => string | null) => EnclosingClassInfo | null;
/** Object literal binding info for TS/JS shorthand methods. */
export interface ObjectLiteralBindingInfo {
    ownerId: string;
    /**
     * Owner name, when the owner is also the member's qualifier.
     *
     * Set by {@link findMemberAssignmentOwnerInfo} so a prototype method keys as
     * `Foo.bar` — without it two constructors in one file that each define
     * `bar` collapse onto a single `Method:<file>:bar` id.
     *
     * {@link findObjectLiteralBindingInfo} sets it ONLY when the caller opts in
     * via `includeOwnerName`. Its `Method` ids must stay exactly as they were —
     * qualifying them would rewrite every object-literal method id in every
     * indexed repo — but object-literal KEYS (indexed since A1/A5) genuinely
     * need it: two config objects in one file sharing a key name otherwise
     * collapse onto a single `Property:<file>:<key>` id, merging two distinct
     * settings into one symbol.
     */
    ownerName?: string;
}
/**
 * Find the file-scope variable that owns an object literal method definition.
 *
 * Covers TypeScript/JavaScript shorthand object methods such as:
 *
 *   export const service = { async load() {} };
 *
 * tree-sitter represents `load` as a `method_definition` inside an `object`,
 * not inside a class container. Without this fallback, ingestion emits a
 * top-level `Method` node but no edge from the exported `service` value to
 * that method, so impact queries cannot discover `service.load`.
 *
 * Two-phase walk:
 *   Phase A walks up from `node` tracking how many `object` ancestors we
 *     cross. The first `variable_declarator` reached with `objectDepth >= 1`
 *     is the candidate owner — unless `objectDepth > 1` (the method belongs
 *     to a nested object literal; we return null rather than misattribute
 *     to the outer binding). Hitting a function/class container before the
 *     declarator returns null (catches IIFE-wrapped literals).
 *   Phase B walks the declarator's own ancestors. Any function or class
 *     ancestor before reaching `program`/`export_statement` returns null
 *     (catches `const` declared inside a function body). Any block-statement
 *     ancestor also returns null (catches block-scoped declarations inside
 *     top-level `if`/`for`/`try`/etc., which cannot be imported).
 */
/**
 * Owner for the keys of an ANONYMOUS object literal in return position (R3-4).
 *
 * `return { symbol, score, wickRatio, … }` binds to nothing, so its keys had no
 * anchor and could not be qualified — which on the reporting repo left the
 * central payload of the signal pipeline, ~25 fields, entirely unqueryable.
 * There are 437 such sites in one backend directory, so this is the dominant
 * shape, not an edge case.
 *
 * The enclosing FUNCTION is the honest owner: the literal is that function's
 * return shape, which is a contract its callers consume. Qualifying by it keeps
 * two functions returning the same key name as two distinct nodes, exactly as
 * `ownerName` does for variable-bound literals.
 *
 * Returns null when the literal is not DIRECTLY returned (a nested literal, or
 * one inside a callback several frames down), because then the enclosing
 * function is not what the object describes.
 */
/**
 * True when this definition node is a key of a literal in RETURN position.
 *
 * Deliberately independent of whether an OWNER NAME could be derived. The two
 * are different questions, and conflating them mislabels the anonymous case:
 * `[function (row) { return { k: row.x }; }]` yields no name to qualify by, so
 * the owner lookup returns null — but the key is still a return shape, and
 * flagging it by owner-presence would leave it looking like a DECLARED anchor
 * and let it outrank a real declaration during narrowing.
 */
export declare const isReturnShapeProperty: (node: SyntaxNode) => boolean;
export declare const findReturnShapeOwnerInfo: (node: SyntaxNode, filePath: string) => {
    readonly ownerId?: string;
    readonly ownerName: string;
} | null;
export declare const findObjectLiteralBindingInfo: (node: SyntaxNode, filePath: string, options?: {
    /**
     * Also return `ownerName` so the member qualifies as `<owner>.<member>`.
     * Opt-in because turning it on for `Method` would rewrite existing ids.
     */
    readonly includeOwnerName?: boolean;
}) => ObjectLiteralBindingInfo | null;
/**
 * Find the owner of a member assigned by `<Owner>.prototype.<member> = fn`
 * (#2723 follow-up).
 *
 * Sibling of {@link findObjectLiteralBindingInfo}: same seam, same return
 * shape, different syntax. There the owner is the variable the literal is
 * bound to; here it is the identifier to the left of `.prototype`.
 *
 * The owner label is read from the file's own module-scope declaration, so the
 * edge points at the node that actually exists — `function Foo() {}` is a
 * `Function` node, `class Foo {}` is a `Class` node. When the file declares no
 * such name (the constructor lives in another module) no owner is claimed:
 * a HAS_METHOD edge to a fabricated node is worse than a top-level Method.
 */
export declare const findMemberAssignmentOwnerInfo: (node: SyntaxNode, filePath: string) => ObjectLiteralBindingInfo | null;
/**
 * The receiver name of a `<Owner>.prototype.<member> = <function>` assignment,
 * or null when `assignment` is not that shape.
 *
 * Only a bare identifier owner is accepted. `a.b.prototype.c = …` and
 * `getClass().prototype.c = …` name an owner this layer cannot resolve to a
 * definition, so they are left alone rather than attributed to a guess.
 */
export declare const prototypeAssignmentOwnerName: (assignment: SyntaxNode) => string | null;
/**
 * The constructor function that owns a `this.member = <function>` assignment,
 * or null when there is none (module top level, or an owner this layer cannot
 * name).
 *
 * Only a `function_declaration` counts. An `arrow_function` does NOT bind its
 * own `this` (ECMA-262 gives it `[[ThisMode]] = lexical`), so the walk passes
 * through arrows to the function that actually binds the receiver — the same
 * rule `@receiver-owner.this` encodes in the scope queries (#2701). A class
 * method never reaches here: parse-worker resolves its owner from the
 * enclosing class container first.
 */
export declare const thisAssignmentOwnerName: (assignment: SyntaxNode) => string | null;
/**
 * True when `node` is a `X.prototype.Y = <function>` or `this.Y = <function>`
 * assignment — i.e. a callable MEMBER rather than a free function.
 *
 * Takes the ASSIGNMENT node, because that is what the `@definition.function`
 * capture is anchored on and therefore what `provider.labelOverride` receives.
 */
export declare const isPrototypeMemberAssignmentNode: (node: SyntaxNode) => boolean;
/**
 * True when `node` is `module.exports = <anonymous function>` (#2723).
 *
 * The whole module IS the callable, so there is no property to take a name
 * from and the caller supplies a file-derived one. A NAMED function expression
 * is excluded — its own name is captured directly and is more informative.
 */
/**
 * True when `node` is `module.exports = <function>`, named or anonymous — the
 * CommonJS default export, where the whole module IS the callable.
 *
 * `exports = fn` is deliberately NOT this shape: reassigning the `exports`
 * binding does not export anything in CommonJS, it only breaks the alias to
 * `module.exports`.
 */
export declare const isCjsDefaultExportAssignment: (node: SyntaxNode) => boolean;
/** True when `node` is a `this.Y = <function>` assignment, at any nesting. */
export declare const isThisMemberAssignmentNode: (node: SyntaxNode) => boolean;
/** Convenience wrapper: returns just the class ID string (backward compat). */
export declare const findEnclosingClassId: (node: SyntaxNode, filePath: string) => string | null;
/**
 * Find a child of `childType` within a sibling node of `siblingType`.
 * Used for Kotlin AST traversal where visibility_modifier lives inside a modifiers sibling.
 */
export declare const findSiblingChild: (parent: SyntaxNode, siblingType: string, childType: string) => SyntaxNode | null;
/** Generic name extraction from a function-like AST node.
 *  Tries `node.childForFieldName('name')?.text`, then scans children for
 *  `identifier` / `property_identifier` / `simple_identifier`.
 *
 *  `arrow_function` and `function_expression` (TS/JS) are inherently
 *  anonymous — they have no `name` field, and their first identifier
 *  child is a *parameter*, not a function name. Returning a parameter
 *  identifier here would synthesize phantom Function IDs (e.g. callers
 *  walking up from a call inside `arr.map(x => fn(x))` would get
 *  attributed to a non-existent "Function x"). The language's
 *  `methodExtractor.extractFunctionName` hook is responsible for naming
 *  these via parent context (variable_declarator, pair, etc.); when it
 *  declines, the parent walk should continue rather than fall through
 *  here. See issue #1166. */
export declare const genericFuncName: (node: SyntaxNode) => string | null;
/** AST node types that represent a method definition (for `inferFunctionLabel`). */
export declare const METHOD_LABEL_NODE_TYPES: Set<string>;
/** AST node types that represent a constructor definition (for `inferFunctionLabel`). */
export declare const CONSTRUCTOR_LABEL_NODE_TYPES: Set<string>;
/** Infer node label from AST node type for function-like nodes without a provider hook. */
export declare const inferFunctionLabel: (nodeType: string) => NodeLabel;
/** Argument list node types shared between countCallArguments and call-resolution helpers. */
export declare const CALL_ARGUMENT_LIST_TYPES: Set<string>;
/**
 * Function/method parameter-list node types across grammars. Used to tell a
 * PARAMETER-property (a constructor parameter that is also a class field, e.g.
 * TypeScript `constructor(public name: string)`) apart from a function-BODY
 * local: a property reached through one of these — rather than through the
 * function's executable body — is a genuine class member, so the
 * function-local-property guard must NOT strip its owner edge.
 */
export declare const PARAMETER_LIST_NODE_TYPES: Set<string>;
/**
 * Executable local-scope boundaries for the property-ownership guard
 * (`isFunctionLocalProperty` in parse-worker.ts). A `Property` capture whose
 * nearest enclosing scope — walking up before any class container — is one of
 * these executable bodies is a function-local binding, NOT a class member, so it
 * must not receive a class `HAS_PROPERTY` owner edge.
 *
 * Derived from FUNCTION_NODE_TYPES, with two deliberate adjustments found by the
 * #1919 review of the original guard:
 *  - EXCLUDES Dart's bare signature wrappers (`function_signature` /
 *    `method_signature`). A Dart getter/setter NAME lives under `method_signature`,
 *    yet it is a class-member declaration, not a local inside an executable body;
 *    treating the signature as a scope boundary OVER-stripped every Dart class
 *    accessor's owner edge. (Signatures are Dart-only; no language emits a
 *    legitimately-function-local Property under one.)
 *  - INCLUDES accessor + initializer bodies (Kotlin `anonymous_initializer` /
 *    `getter` / `setter`, Swift `computed_property` / `computed_getter` /
 *    `computed_setter` / `computed_modify`). Destructuring/locals inside these ARE
 *    function-local, yet they are absent from FUNCTION_NODE_TYPES; omitting them
 *    UNDER-stripped and emitted spurious class `HAS_PROPERTY` edges for
 *    `init {}` / accessor-body destructuring bindings.
 *
 * Kept separate from FUNCTION_NODE_TYPES because that set has many other consumers
 * (e.g. enclosing-callable resolution) where signatures must remain function nodes
 * and accessor bodies must not.
 */
export declare const LOCAL_SCOPE_BODY_NODE_TYPES: ReadonlySet<string>;
/**
 * Callable node types whose grammar splits the body off into a SIBLING node, so
 * the callable is never an ancestor of the code inside it (Dart
 * `function_signature` / `method_signature`).
 *
 * Derived, not listed, so it cannot drift from the two sets that define it:
 * `LOCAL_SCOPE_BODY_NODE_TYPES` is `FUNCTION_NODE_TYPES` minus exactly the bare
 * signature types, so the difference IS the split-signature set.
 *
 * Must stay BELOW `LOCAL_SCOPE_BODY_NODE_TYPES` — reading it earlier hits the
 * temporal dead zone and throws at module load.
 */
export declare const SPLIT_SIGNATURE_NODE_TYPES: ReadonlySet<string>;
/** Walk an AST node depth-first, returning the first descendant with the given type. */
export declare function findDescendant(root: SyntaxNode, type: string): SyntaxNode | null;
/** Extract the text content from a string or encapsed_string AST node. */
export declare function extractStringContent(node: SyntaxNode | null | undefined): string | null;
/** Find the first direct named child of a tree-sitter node matching the given type. */
export declare function findChild(node: SyntaxNode, type: string): SyntaxNode | null;
/** Remove bidi-override and zero-width control characters from attacker-
 *  influenced repository text before it is exposed through graph descriptions
 *  or MCP output (#2286). Global `sanitizeUTF8` intentionally remains focused
 *  on encoding/control-character validity. */
export declare const stripBidiAndZeroWidth: (text: string) => string;
/**
 * Extract the normalized text of a leading doc comment immediately preceding a
 * definition node — covering both block doc comments (Javadoc / KDoc / JSDoc /
 * PHPDoc / Doxygen, opened by `/**` or `/*!`) and runs of line doc comments
 * (`///`, `//!`, or the caller-supplied prefixes such as Go's `//` or Ruby's
 * `#`). Returns `undefined` when there is no preceding doc comment or it is
 * empty.
 *
 * Grammar-agnostic by design: matches on the comment text prefix rather than a
 * grammar node type, because the comment node is named differently across
 * grammars (`block_comment`, `multiline_comment`, `comment`, `line_comment`).
 * Annotations and modifiers live inside the definition node, so the doc comment
 * remains the definition's `previousNamedSibling` even on annotated/decorated
 * declarations.
 *
 * Block comments are taken as the immediately-preceding sibling (intervening
 * package/import/code siblings already shield a file-level license block from
 * the first declaration). Line doc comments enforce row-adjacency: the first
 * comment must sit on the line directly above the definition, and each comment
 * walked further up must sit directly above the previous one — so a run stops
 * at a blank line. This matches godoc/RDoc/rustdoc convention and prevents an
 * unrelated comment block (a license header, a Ruby shebang + magic comment)
 * separated by a blank line from being absorbed. Adjacency is checked on
 * `startPosition.row` (reliable) rather than `endPosition.row`, since some
 * grammars fold the trailing newline into the comment node.
 *
 * Normalization mirrors Python docstring handling: strip the comment delimiters
 * / per-line markers, then collapse whitespace to single spaces so tag content
 * (`@param`, `@deprecated since 2.0, use computeBalanceV2`) survives.
 *
 * When the captured definition is an inner node and its own preceding sibling
 * carries no doc, the search retries from a wrapping node whose type is listed in
 * `opts.wrapperNodeTypes` (e.g. an `export_statement` wrapping an exported
 * function/class — the JSDoc precedes the wrapper, not the inner declaration).
 */
export interface LeadingDocCommentOptions {
    /** Line-comment doc prefixes (defaults to {@link DEFAULT_LINE_DOC_PREFIXES};
     *  Go passes `['//']`, Ruby passes `['#']`). */
    lineCommentPrefixes?: readonly string[];
    /** Grammar node types that wrap a definition such that the doc comment is the
     *  wrapper's preceding sibling rather than the definition's. TS/JS pass
     *  `['export_statement']`. Empty by default → no wrapper retry. */
    wrapperNodeTypes?: readonly string[];
    /** Line-comment prefixes that are tool/build directives or magic comments
     *  rather than documentation (Go passes `['//go:', '// +build', …]`, Ruby
     *  passes `['# frozen_string_literal:', '#!', …]`). A matching line is skipped
     *  in the doc run rather than absorbed. Empty by default. */
    lineDirectivePrefixes?: readonly string[];
    /** Block-comment doc openers (defaults to `['/**', '/*!']`). Rust passes
     *  `['/**']` so its inner-doc `/*!` does not attach to the following item. */
    blockDocPrefixes?: readonly string[];
}
export declare function extractLeadingDocComment(node: SyntaxNode, opts?: LeadingDocCommentOptions): string | undefined;
/** Node labels that can carry a leading doc comment — callables and type-like
 *  declarations. Field/property/variable/const doc is intentionally excluded
 *  (issue #2270 scopes this to method/type documentation). Language-neutral:
 *  a label a given grammar never emits simply never matches.
 *
 *  Bounded to labels that are also in `embeddings/types.ts` `EMBEDDABLE_LABELS`:
 *  the description is only useful once it reaches the embedding metadata header,
 *  and the embedding pipeline only queries embeddable labels. Extracting docs
 *  for a non-embeddable label is a wasted write that never becomes searchable.
 *  A subset invariant in the unit tests guards against drift. Making currently-
 *  non-embeddable doc-bearing labels (Module, Delegate, Annotation, and C++
 *  `Template`) searchable is tracked as a follow-up — it needs an embedding-
 *  pipeline/schema change beyond this fix. */
export declare const DOC_BEARING_LABELS: ReadonlySet<NodeLabel>;
/**
 * Build a `LanguageProvider.descriptionExtractor` that surfaces a definition's
 * leading doc comment as its `description` (issue #2270). For labels in
 * {@link DOC_BEARING_LABELS} (which is bounded to embeddable labels) the text
 * then reaches the embedding metadata header and becomes semantically searchable.
 *
 * Language-neutral factory (names no language): guards on
 * {@link DOC_BEARING_LABELS}; callers pass per-language doc-comment behavior via
 * {@link LeadingDocCommentOptions} (line prefixes, export-style wrappers, …)
 * which is threaded straight through to {@link extractLeadingDocComment}.
 */
export declare const createLeadingDocDescriptionExtractor: (opts?: LeadingDocCommentOptions) => ((nodeLabel: NodeLabel, nodeName: string, captureMap: Record<string, SyntaxNode | undefined>) => string | undefined);
/** Convert a tree-sitter node to a `Capture` with 1-based line numbers
 *  (matching RFC §2.1). The tag includes the leading `@`. */
export declare function nodeToCapture(name: string, node: SyntaxNode): Capture;
/** Build a `Capture` whose range mirrors `atNode` but whose `text` is
 *  caller-supplied. Used to synthesize markers that don't have a
 *  corresponding source token. */
export declare function syntheticCapture(name: string, atNode: SyntaxNode, text: string): Capture;
/** Walk a subtree to find a node whose range exactly matches AND whose
 *  type matches `expectedType` (when given). When multiple nodes share
 *  the range — e.g., `function_definition` and its inner `block` body
 *  for a one-liner — the type filter disambiguates.
 *
 *  Iterative depth-first-left-to-right via an explicit stack. Children
 *  are pushed in reverse index order so LIFO pop visits them in source
 *  order. Prunes branches that can't contain the target range by
 *  row bounds — same optimization the prior recursive form used, minus
 *  the early-break since stack-push is cheap. */
export declare function findNodeAtRange(root: SyntaxNode, range: Range, expectedType?: string): SyntaxNode | null;
/**
 * Return the captured node if its type is one of `types`, else null.
 *
 * The threaded-node equivalent of `findNodeAtRange(root, capture.range, type)`
 * for the common case where a tree-sitter query already hands you the matched
 * node (`c.node`): the captured node IS the node at that range, so a type check
 * is exact and there is no need to re-walk from the tree root (the
 * O(matches × rootChildren) hot path #1848 hit). Unlike `findNodeAtRange`, this
 * does NOT traverse — the caller must already hold the node; for a multi-type
 * call the node must literally be one of `types` (no fallback search).
 *
 * Used by every language's scope-capture path (go/python/ruby/php/rust/csharp).
 */
export declare function nodeIfType<T extends SyntaxNode>(node: T | undefined, ...types: readonly string[]): T | null;
export {};
