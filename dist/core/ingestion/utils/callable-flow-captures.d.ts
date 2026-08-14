/**
 * Configurable AST-to-`@callable-flow.*` capture synthesis.
 *
 * The traversal is language-neutral: providers supply their grammar's node
 * vocabulary and the small semantic callbacks (true-reference bindings,
 * callable signatures, protocol invocation names). The central extractor
 * never sees a parser node and shared ingestion code never branches on a
 * language name.
 *
 * ## The cell/site model
 *
 * A *cell* is a named storage location that may hold a callable — a variable,
 * parameter, field or pointer, canonicalized to a binding key by the scope
 * tree. A *site* is one observed fact about cells, emitted here as a capture
 * match and consumed by `passes/callable-value-flow.ts`, which runs them to a
 * fixpoint. The site kinds (`CallableFlowSite`) are:
 *
 * - `seed` — a cell acquires a named callable: `f = target`. Carries
 *   `@callable-flow.target-name`, the name the pass resolves against.
 * - `copy` / `alias` — a cell takes another cell's contents, so targets flow
 *   between them.
 * - `address` / `store` / `load` — indirection through a pointer cell.
 * - `formal` — a parameter cell of a known function, by index.
 * - `argument` — a callable passed at a call site, binding to that `formal`.
 * - `invoke` — a call THROUGH a cell (`f()`), the site that ultimately becomes
 *   a `CALLS` edge once the cell's target set is known.
 *
 * ## The anonymous-callable convention
 *
 * A closure literal has no name to resolve against, so a `seed` whose source
 * is an anonymous callable takes its **destination's** name as
 * `@callable-flow.target-name` — `val f = { }` seeds "the cell `f` holds the
 * callable named `f`". That is deliberately self-referential and only resolves
 * because the binding itself is a callable target: `buildGraphTargetIndex`
 * admits it on the label of the graph node it resolves to, which #2687 makes a
 * `Function` for exactly this construct. Languages whose closure binding does
 * NOT emit a callable graph node get no resolution from the convention alone
 * (#2693).
 *
 * ## Adding a language
 *
 * Supply `CallableFlowCaptureOptions` from `<lang>/captures.ts` and call
 * `synthesizeCallableFlowCaptures`. Two recurring traps:
 *
 * - A **fieldless** assignment/binding node decomposes to nothing under the
 *   shared `left`/`name`/`value` fallback in `assignmentParts`. Supply
 *   `extractAssignment` (Kotlin's `assignment`, Dart's
 *   `initialized_identifier`). Returning `undefined` falls back to the shared
 *   path, so one callback can handle the odd node and leave the rest alone.
 * - A binding needs a `SymbolDefinition` for the pass to attach to. Captures
 *   alone are not enough: without a `@declaration.*` for the bound name, the
 *   seed has no cell to key on.
 *
 * `c/captures.ts` is the fullest worked example (pointers, signatures,
 * overload selection); `dart/captures.ts` the smallest interesting one.
 */
import type { CaptureMatch, ParameterTypeClass } from '../../../_shared/index.js';
import { type SyntaxNode } from './ast-helpers.js';
export interface CallableCaptureSignature {
    readonly parameterCount?: number;
    readonly parameterTypes?: readonly string[];
    readonly parameterTypeClasses?: readonly ParameterTypeClass[];
    readonly isConst?: boolean;
}
export interface CallableFlowCaptureOptions {
    readonly functionNodeTypes: ReadonlySet<string>;
    readonly callNodeTypes: ReadonlySet<string>;
    readonly parameterListNodeTypes: ReadonlySet<string>;
    readonly parameterNodeTypes: ReadonlySet<string>;
    readonly bindingNodeTypes: ReadonlySet<string>;
    readonly assignmentNodeTypes: ReadonlySet<string>;
    readonly identifierNodeTypes: ReadonlySet<string>;
    /** Control-flow blocks do not introduce a new local-variable scope. */
    readonly functionScopedValueBindings?: boolean;
    /**
     * Declaration nodes whose callable type can contextually select an overload
     * at a later assignment (for example `void (*fp)(int); fp = target;`).
     */
    readonly callableSignatureDeclarationNodeTypes?: ReadonlySet<string>;
    /** Nodes that denote a named callable reference rather than a value read. */
    readonly callableReferenceNodeTypes?: ReadonlySet<string>;
    /** Member methods whose receiver itself is the callable object. */
    readonly callableProtocolMethods?: ReadonlySet<string>;
    /** Operators used for receiver-bound member-pointer invocation. */
    readonly memberPointerOperators?: ReadonlySet<string>;
    /** Provider fallback for member-pointer syntax a grammar recovers as ERROR nodes. */
    readonly memberPointerParts?: (node: SyntaxNode) => {
        readonly receiver: SyntaxNode;
        readonly member: SyntaxNode;
        readonly operator: string;
    } | undefined;
    readonly functionName?: (node: SyntaxNode) => string | undefined;
    /** Map grammar-specific split signature/body shapes to one lexical owner. */
    readonly lexicalFunctionOwner?: (node: SyntaxNode) => SyntaxNode | undefined;
    readonly parameterPassingMode?: (parameter: SyntaxNode) => 'value' | 'reference' | 'pointer' | 'callable-object';
    readonly isTrueReferenceBinding?: (container: SyntaxNode, destination: SyntaxNode) => boolean;
    readonly expectedSignature?: (container: SyntaxNode, destination: SyntaxNode) => CallableCaptureSignature | undefined;
    readonly normalizeQualifiedName?: (raw: string) => string;
    /**
     * Provider-owned assignment decomposition. May return MULTIPLE pairs for
     * one node — Go's multi-value `a, b := f, g` pairs positionally; the
     * shared field fallback would cross-wire first-LHS with last-RHS (#2522
     * review). Returning an empty array means "recognized, but emit nothing"
     * (e.g. a multi-return call RHS with mismatched arity).
     */
    readonly extractAssignment?: (node: SyntaxNode) => {
        readonly destination: SyntaxNode;
        readonly source: SyntaxNode;
    } | readonly {
        readonly destination: SyntaxNode;
        readonly source: SyntaxNode;
    }[] | undefined;
    readonly extractFunctionParameters?: (node: SyntaxNode) => readonly SyntaxNode[] | undefined;
    readonly extractCallCallee?: (node: SyntaxNode) => SyntaxNode | undefined;
    readonly isCallNode?: (node: SyntaxNode) => boolean;
    /**
     * Languages where a bare, receiver-less, paren-less name in value position
     * is a CALL, not a reference (Ruby: `action = process` invokes `process`
     * and stores its return). When true, a bare name that is not a provably
     * local value binding and not an explicit reference form (`method(:x)`,
     * lambda/proc) emits NO flow fact — treating it as a callable minted CALLS
     * edges to methods that were merely invoked (#2522 review).
     */
    readonly bareNamesAreCalls?: boolean;
    readonly callSiteNode?: (node: SyntaxNode) => SyntaxNode | undefined;
    /** Emit a canonical call ReferenceSite when the provider query omits variable calls. */
    readonly emitCanonicalInvokeReference?: boolean;
    readonly extractCallableReference?: (node: SyntaxNode) => {
        readonly name: string;
        readonly anchor: SyntaxNode;
        readonly qualifiedName?: string;
    } | undefined;
}
/**
 * Emit normalized flow captures in deterministic source order.
 *
 * One explicit DFS supplies all phases below. Query-backed emitters may still
 * perform their existing query walk; this helper never reparses and remains
 * linear in AST size (the scope-capture benchmark guards the scaling ratio).
 */
export declare function synthesizeCallableFlowCaptures(root: SyntaxNode, options: CallableFlowCaptureOptions): readonly CaptureMatch[];
/**
 * For a subscript/index expression, the identifier of interest is always in
 * the container operand, never the index: `tbl[i] = h` must bind the cell
 * `tbl` (index-insensitive, Andersen-style), not the index variable `i` —
 * seeding `i` both pollutes a same-named formal and misses the later
 * `tbl[i]()` join (#2522 review). Field names cover the grammars that field
 * their subscript nodes; others keep the generic traversal.
 */
/** The container operand of a subscript node, per grammar. Exported because the
 *  receiver-chain walk needs the same per-grammar answer — two divergent field
 *  tables for one question is how a new grammar gets half-supported. */
export declare function subscriptBase(node: SyntaxNode): SyntaxNode | null;
