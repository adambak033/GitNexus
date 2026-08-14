/**
 * TS/JS CfgVisitor (issue #2081, M1).
 *
 * Walks a TypeScript/JavaScript function's tree-sitter AST and drives the
 * language-agnostic {@link CfgBuilder} to produce a serializable
 * {@link FunctionCfg}. TS and JS share a grammar family (tree-sitter-typescript
 * reuses tree-sitter-javascript's statement nodes), so one visitor covers both.
 *
 * Design — a `visit_<node_type>` dispatch over the statement taxonomy. The
 * classic CFG hazards (R10) are handled explicitly:
 *  - loops allocate a dedicated **loop-exit** block so `break` has a concrete
 *    target before the loop's successor is known; `continue` targets the
 *    header/increment; the back-edge closes the loop.
 *  - `switch` cases fall through naturally: a case body that does not `break`
 *    yields non-empty `exits`, which we wire to the next case as `fallthrough`;
 *    a case that `break`s wires to the switch exit (via {@link ControlFlowContext})
 *    and yields no fall-out.
 *  - `try/catch/finally` routes both normal completion AND a `throw` in the try
 *    through `finally` (the finally block post-dominates the try/catch); a
 *    `throw` with no catch propagates through finally to the enclosing handler.
 *  - EARLY EXITS THROUGH FINALLY (#2082 M2 U2, closes the M1 soundness gap): a
 *    `break`/`continue`/`return` whose jump CROSSES a `finally` is re-routed to
 *    the finally entry (keeping its bare jump kind), and the finally's exits
 *    gain a `finally-return`/`finally-break`/`finally-continue` completion edge
 *    to the resumed target. Threading is TARGET-RELATIVE via finalizer frames
 *    interleaved on the {@link ControlFlowContext} stack: only the finallys
 *    lexically between the jump and its target thread (a `break` whose loop is
 *    wholly inside the try keeps its direct edge — re-routing it would let a
 *    finally redefinition falsely kill in-loop defs for reaching-defs). Nested
 *    finallys chain inner→outer; finally-as-shared-join conflates exit paths
 *    (sound over-approximation; duplication-per-exit-path was rejected). An
 *    empty/comment-only finally pushes no frame — jumps keep direct edges.
 *  - labeled `break`/`continue` resolve against the labeled construct's frame:
 *    loops/switches carry their full label LIST (`outer: inner: for` resolves
 *    both), and a labeled NON-loop statement (`blk: { … break blk; … }`) gets
 *    a break-target frame whose target is a synthesized join after the body —
 *    the M1 route-to-EXIT fallback removed the real continuation and falsely
 *    killed defs for reaching-defs (tri-review P1).
 *
 * Known limitations:
 *  - A jump whose label STILL fails to resolve (malformed source) keeps the
 *    conservative route-to-EXIT + thread-all-finallys fallback in
 *    visitBreak/visitContinue — single-exit preserved, no finally bypassed,
 *    but the continuation path is approximate.
 *  - Exceptional flow stays the sound over-approximation: EVERY protected-region
 *    block edges to the handler (an exception may fire mid-block), which
 *    over-supplies reaching-defs facts into `catch` — extra facts, never false
 *    kills. Per-leader throw precision is deliberately deferred (M3 decides).
 *  - Def/use harvest scope (#2082 M2, see typescript-harvest.ts for the full
 *    v1 semantics table): member/property writes are not scalar defs; nested
 *    function bodies are opaque in BOTH directions (writes to and reads of
 *    captured outer variables are invisible — callback flows are M4 territory);
 *    `case x:` test uses attach to the switch dispatch block (sound
 *    over-approximation of in-order case evaluation).
 *
 * Block/edge accounting and reachability are pinned in
 * `test/unit/cfg/cfg-builder.test.ts` (core) and
 * `test/unit/cfg/typescript-visitor.test.ts` (this visitor, per hazard).
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { CfgVisitor } from '../types.js';
/** TS/JS node types that own a CFG-bearing function body. */
declare const TS_FUNCTION_TYPES: Set<string>;
/** The TS/JS CFG visitor (shared by TypeScript and JavaScript). */
export declare function createTypeScriptCfgVisitor(): CfgVisitor<SyntaxNode>;
export { TS_FUNCTION_TYPES };
