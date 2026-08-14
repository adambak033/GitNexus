import type { MixedChainStep } from '../../../_shared/index.js';
import type { SyntaxNode } from './ast-helpers.js';
/** Node types representing call expressions across supported languages. */
export declare const CALL_EXPRESSION_TYPES: Set<string>;
/**
 * Hard limit on chain depth to prevent runaway recursion.
 * For `a.b().c().d()`, the chain has depth 2 (b and c before d).
 *
 * A chain deeper than this is DISCARDED WHOLE, not truncated:
 * `extractMixedChain` returns an undefined base and the encoder refuses to mint
 * a partial chain, because a base-side prefix decodes cleanly as a shorter,
 * complete-looking chain and would type the receiver against the wrong member.
 * Correct, but it means a builder chain one hop too long contributes nothing at
 * all rather than degrading.
 *
 * DELIBERATELY NOT RAISED. Measured (see bench/receiver-resolution/BASELINE.md,
 * `fourHopChain`): a 4-step chain mints NOTHING at this cap — confirmed by
 * probing the emitter directly — and the site still RESOLVES, because the text
 * cascade that owns the fallback path runs to `COMPOUND_RECEIVER_MAX_DEPTH` (8)
 * and answers where the structural fold declined.
 *
 * So the cap bounds which chains are typed STRUCTURALLY, not which calls
 * resolve. Raising it moves work from the cascade to the fold without changing
 * any edge, and the fixture that proves it is committed so the next person to
 * reach for this number has the measurement rather than the intuition.
 */
export declare const MAX_CHAIN_DEPTH = 3;
/**
 * Count direct arguments for a call expression across common tree-sitter grammars.
 * Returns undefined when the argument container cannot be located cheaply.
 */
export declare const countCallArguments: (callNode: SyntaxNode | null | undefined) => number | undefined;
type CallForm = 'free' | 'member' | 'constructor';
/**
 * Infer whether a captured call site is a free call, member call, or constructor.
 * Returns undefined if the form cannot be determined.
 *
 * Works by inspecting the AST structure between callNode (@call) and nameNode (@call.name).
 * No tree-sitter query changes needed — the distinction is in the node types.
 */
export declare const inferCallForm: (callNode: SyntaxNode, nameNode: SyntaxNode) => CallForm | undefined;
export declare const extractReceiverName: (nameNode: SyntaxNode) => string | undefined;
/**
 * Extract the raw receiver AST node for a member call.
 * Unlike extractReceiverName, this returns the receiver node regardless of its type —
 * including call_expression / method_invocation nodes that appear in chained calls
 * like `svc.getUser().save()`.
 *
 * Returns undefined when the call is not a member call or when no receiver node
 * can be found (e.g. top-level free calls).
 */
export declare const extractReceiverNode: (nameNode: SyntaxNode) => SyntaxNode | undefined;
/**
 * One step in a mixed receiver chain.
 *
 * Owned by `gitnexus-shared` — it is part of the ScopeExtractor output
 * contract, and resolution consumes it. Re-exported here so the producer's
 * existing importers keep a single import site.
 */
export type { MixedChainStep };
/**
 * Walk a receiver AST node that is itself a call expression, accumulating the
 * chain of intermediate method names up to MAX_CHAIN_DEPTH.
 *
 * For `svc.getUser().save()`, called with the receiver of `save` (getUser() call):
 *   returns { chain: ['getUser'], baseReceiverName: 'svc' }
 *
 * For `a.b().c().d()`, called with the receiver of `d` (c() call):
 *   returns { chain: ['b', 'c'], baseReceiverName: 'a' }
 */
export declare function extractCallChain(receiverCallNode: SyntaxNode): {
    chain: string[];
    baseReceiverName: string | undefined;
} | undefined;
export declare function extractMixedChain(receiverNode: SyntaxNode): {
    chain: MixedChainStep[];
    baseReceiverName: string | undefined;
} | undefined;
/** Arg types per call position (literals + optional TypeEnv for ids); undefined if unusable */
export declare const extractCallArgTypes: (callNode: SyntaxNode, inferLiteralType: (node: SyntaxNode) => string | undefined, typeEnvLookup?: (varName: string, callNode: SyntaxNode) => string | undefined) => (string | undefined)[] | undefined;
