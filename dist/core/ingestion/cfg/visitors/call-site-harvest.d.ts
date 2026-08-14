/**
 * Shared call-site taint substrate for the C-family CFG harvesters (#2195 U6,
 * plan R7 / KTD2) — the language-agnostic mechanism the C/C++, C#, Java and Go
 * harvesters layer their grammar-specific call/member walks on top of.
 *
 * This file is PURE MECHANISM: it contains no tree-sitter node-type or field
 * literals (each harvester supplies those when it drives `openCallSite` /
 * `addMemberRead` / `setFrameArg`), so it names no language and carries nothing
 * the grammar-literal CI gate needs to validate. It is the C-family analogue of
 * the `FactAccumulator` site machinery in
 * {@link import('./typescript-harvest.js')} — extracted into one place because
 * the four C-family harvesters already share an identical def/use accumulator,
 * and the site layer is identical across them too (only the per-grammar node
 * shapes differ, and those live in each harvester's `walkValue`/`visitCall`).
 *
 * Produces the same {@link SiteRecord} shape the (future, deferred) shared
 * taint matcher consumes uniformly across all languages: callee path, receiver,
 * per-argument occurrence entries (with sanitizer-interposition via-tags),
 * result defs, spread/template markers, and member reads. INERT BY DESIGN — no
 * C-family source/sink/sanitizer model is registered today (`getSourceSinkConfig`
 * returns undefined for every C-family language), so a harvest with no model
 * produces ZERO TAINTED edges; this only emits the substrate the deferred model
 * work will match against.
 *
 * Sites are emitted on {@link StatementFacts.sites} only when non-empty, exactly
 * like the TS harvester — flag-off runs never harvest, and most fact-bearing
 * statements carry no calls.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { StatementFacts } from '../types.js';
/**
 * Minimal ordered, deduplicating def/use collector for one statement record,
 * with NO call-site machinery (#2195 U7). The Kotlin / Python / Ruby / Rust /
 * Dart / Swift harvesters each carried a BYTE-IDENTICAL copy of this class:
 * those units harvest NO call sites (the taint substrate is a later step), so a
 * site-free accumulator keeps their emitted facts free of any `sites` key
 * (matching the Python harvester) and byte-identical to one another. This is the
 * no-site sibling of {@link CallSiteFactAccumulator}; `finish` omits `sites`
 * entirely. `useCount` is live (Ruby's emit guard is `defCount() ||
 * useCount()`).
 */
export declare class DefUseAccumulator {
    private readonly line;
    private readonly defs;
    private readonly uses;
    private readonly mayDefs;
    private readonly defSeen;
    private readonly useSeen;
    private readonly mayDefSeen;
    constructor(line: number);
    addDef(idx: number): void;
    /** A def that may not execute (conditional context) — gen without kill. */
    addMayDef(idx: number): void;
    addUse(idx: number): void;
    defCount(): number;
    useCount(): number;
    finish(): StatementFacts;
}
/**
 * Defensive per-statement cap on harvested taint `sites` (#2195 U11). A real
 * statement carries a handful of call / member-read sites; this only bounds a
 * pathological or machine-generated statement (e.g. hundreds of nested calls)
 * from producing an unbounded site list. Mirrors the PDG edge/fact caps' style
 * (a generous-but-finite limit, checked before each push). Overflow is silent
 * but observable via {@link CallSiteFactAccumulator.sitesTruncated}; the first
 * `DEFAULT_PDG_MAX_SITES_PER_STATEMENT` sites are kept fully intact (callee,
 * args, parent), the over-cap tail is dropped.
 */
export declare const DEFAULT_PDG_MAX_SITES_PER_STATEMENT = 512;
/**
 * Ordered, deduplicating def/use collector for one statement record, PLUS the
 * call-site harvest machinery (#2195 U6). A drop-in superset of the simple
 * def/use accumulator the C-family harvesters used before the substrate landed
 * — `addDef`/`addMayDef`/`addUse`/`defCount`/`useCount`/`finish` are unchanged,
 * so harvesters that never open a site emit byte-identical facts (no `sites`
 * key, since `finish` omits it when empty).
 */
export declare class CallSiteFactAccumulator {
    private readonly line;
    private readonly defs;
    private readonly uses;
    private readonly mayDefs;
    private readonly defSeen;
    private readonly useSeen;
    private readonly mayDefSeen;
    /** Taint sites recorded for this statement. */
    private readonly sites;
    /** Composite (object|property|parent) keys of recorded member-read sites — O(1) dedup. */
    private readonly memberReadKeys;
    /** Stack of open call/new sites — the occurrence fan-out targets. */
    private readonly frames;
    /** Set once the per-statement site cap is hit; over-cap sites are dropped. */
    private _sitesTruncated;
    constructor(line: number);
    /** True iff this statement hit {@link DEFAULT_PDG_MAX_SITES_PER_STATEMENT}. */
    get sitesTruncated(): boolean;
    addDef(idx: number): void;
    /** A def that may not execute (conditional context) — gen without kill. */
    addMayDef(idx: number): void;
    addUse(idx: number): void;
    /**
     * Statement-level use that is NOT a value occurrence in any open site
     * argument — bare callee names only (see each harvester's `visitCall`).
     */
    addUseWithoutOccurrence(idx: number): void;
    defCount(): number;
    useCount(): number;
    /** `[defs.length, mayDefs.length]` marker for {@link defsSince}. */
    defSnapshot(): readonly [number, number];
    /** Binding indices def'd (must- OR may-) since the snapshot was taken. */
    defsSince(snap: readonly [number, number]): number[];
    /**
     * Open a call/new site; parent = innermost enclosing argument position.
     * Returns the new site index, or -1 when the per-statement site cap is hit
     * (the caller threads -1 through `pushFrame`/`setSite*`, all of which no-op on
     * a sentinel index — see {@link DEFAULT_PDG_MAX_SITES_PER_STATEMENT}).
     *
     * `at` is the call/new node's anchor position `[line (1-based), col (0-based)]`
     * — the SAME position the CALLS-edge resolution keys on (see
     * {@link SiteRecord.at} for the KTD7 alignment); the harvester passes its
     * `visitCall`/`visitNew` node's `startPosition` so the downstream resolved-id
     * join lands by exact position.
     */
    openCallSite(kind: 'call' | 'new', at?: readonly [number, number]): number;
    pushFrame(siteIdx: number): void;
    popFrame(): void;
    /** Set the argument position the top frame is currently walking. */
    setFrameArg(argIdx: number): void;
    /**
     * Run `fn` with all open arg frames temporarily detached (argIdx = -1), so
     * identifier reads inside still record USES but do NOT fan occurrences into
     * the enclosing sink-argument position (e.g. the non-value operands of a
     * comma expression — only the final operand's value flows).
     */
    suppressOccurrences(fn: () => void): void;
    setSiteCallee(siteIdx: number, callee: string): void;
    setSiteReceiver(siteIdx: number, receiver: number): void;
    setSiteResultDefs(siteIdx: number, resultDefs: readonly number[]): void;
    setSiteSpread(siteIdx: number, firstSpreadArg: number): void;
    /**
     * Record a value-position member read. Exact duplicates within the statement
     * (same object/property/parent position) dedup; reads at DIFFERENT argument
     * positions stay distinct (`exec(req.body, req.body)` is two occurrences).
     */
    addMemberRead(object: number, property: string): void;
    private innermostArgPosition;
    /**
     * Fan a binding occurrence out to every arg-active open frame, via-tagged
     * with the site of the IMMEDIATELY nested frame when one exists:
     * `exec(escape(x))` puts a plain `x` in escape's arg 0 and `[x, escapeIdx]`
     * in exec's arg 0 — the sanitizer-interposition substrate.
     */
    private recordOccurrence;
    private pushArgEntry;
    finish(): StatementFacts;
}
/**
 * Per-grammar hooks the shared {@link finalizeChain} terminal needs but cannot
 * name itself (it carries no tree-sitter literals — see the file header). Each
 * harvester supplies the two callbacks bound to its own `this`.
 */
export interface ChainTerminalHooks {
    /** Resolve a binding-target node to its function-table binding index. */
    resolve(node: SyntaxNode): number;
    /**
     * Walk a NON-identifier chain root for its uses + nested sites (the terminal's
     * `else` branch — `self.x.f()`, `foo().bar`, a tuple index, etc.).
     */
    walkRoot(node: SyntaxNode): void;
}
/**
 * Shared `walkChain` TERMINAL (#2227 follow-up, plan KTD5/U8) — the byte-identical
 * post-unwind block the Go / Kotlin / Swift / Rust / Python harvesters all ran
 * after walking their grammar-specific access chain (`selector_expression` /
 * `navigation_expression` / `field_expression` / `attribute`) into an
 * `accesses: string[]` list and a resolved root node `cur`.
 *
 * It records the chain-root identifier as a use, emits at most ONE member-read
 * site — the INNERMOST access — when the root is an identifier (suppressed by
 * `skipFinalRead` when that access IS the callee, carried by the dotted path
 * instead), and builds the dotted path `[root, ...accesses].join('.')`. The only
 * per-grammar bit is the root identifier node type, supplied via `isRootIdType`
 * (`'identifier'` for Go/Rust/Python, `'simple_identifier'` for Kotlin/Swift);
 * the `resolve` / `walkRoot` callbacks bind the harvester's own methods. The
 * `addUse` / `addMemberRead` machinery is on the accumulator itself, so it is
 * called directly (no callback). Behavior is identical to the inlined terminals
 * this replaces — the per-language harvest tests are the characterization lock.
 */
export declare function finalizeChain(acc: CallSiteFactAccumulator, cur: SyntaxNode, accesses: readonly string[], skipFinalRead: boolean, isRootIdType: (type: string) => boolean, hooks: ChainTerminalHooks): {
    path?: string;
    rootIdx?: number;
};
