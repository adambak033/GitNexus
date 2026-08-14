/**
 * Scope-resolution → legacy graph-node ID bridging.
 *
 * Two functions:
 *   - `resolveDefGraphId` — turn a scope-resolution `SymbolDefinition`
 *     into the graph's node id for the corresponding legacy node.
 *   - `resolveCallerGraphId` — walk a scope chain from a reference
 *     site upward to find the enclosing function/method/class and
 *     return its graph-node id. Falls back to the File node for
 *     module-level calls so those still get an edge source.
 *
 * Next-consumer contract: language-agnostic. Any OO language with
 * file-level module semantics (TypeScript, Java, Go, Kotlin) can
 * reuse `resolveCallerGraphId` as-is. Languages with different
 * top-level semantics (COBOL programs, Rust crate modules) may want
 * a different file-level fallback — cross that bridge when they
 * migrate.
 */
import type { NodeLabel, ParameterTypeClass, ScopeId, SymbolDefinition } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import { type GraphNodeLookup } from '../graph-bridge/node-lookup.js';
/**
 * Labels that may legitimately ANCHOR a CALLS/ACCESSES edge as the
 * source ("caller"). A Variable / Property can be the TARGET of an
 * edge (e.g., a write-access to `user.name`), but it cannot be a
 * caller — variables don't execute code, so attributing a call to a
 * sibling Variable in the same scope produces nonsense edges like
 * `Variable:create → Function:create` (which the simpleKey fallback
 * in `resolveDefGraphId` then silently rewrites to
 * `Function:create → Function:create`, a self-loop that doesn't exist
 * in the source).
 *
 * Module-level call expressions inside a `const X = expr(args)`
 * declaration are the canonical case where this used to fail: the
 * walk-up over module scope's ownedDefs (only Variables) would land
 * on the FIRST Variable, get name-aliased to its sibling Function
 * with the same simple name, and emit a self-CALLS. With this label
 * restricted to function/class-likes, those calls correctly fall
 * through to the File-node fallback at the bottom of the walk.
 */
export declare const CALLER_ANCHOR_LABELS: ReadonlySet<NodeLabel>;
export declare function resolveDefGraphId(filePath: string, def: {
    /** Scope-resolution def id — carries the declaration position (#2699). */
    nodeId?: string;
    qualifiedName?: string;
    type?: NodeLabel;
    parameterTypes?: readonly string[];
    parameterTypeClasses?: readonly ParameterTypeClass[];
    parameterCount?: number;
    templateArguments?: readonly string[];
    templateConstraints?: unknown;
    /** #1982 bridge-held namespace path; see `SymbolDefinition.namespacePrefix`. */
    namespacePrefix?: string;
}, nodeLookup: GraphNodeLookup): string | undefined;
/** Derive the simple (unqualified) name of a def from its `qualifiedName`. */
export declare function simpleQualifiedName(def: SymbolDefinition): string | undefined;
/**
 * Walk the scope chain from `startScope` upward looking for the first
 * scope whose `ownedDefs` contains a callable or class-like anchor — that's
 * our caller anchor. Translate via `nodeLookup` to the graph-node ID.
 *
 * Module-level references (e.g. Python `u = models.User()` at top
 * level) have no enclosing function/method/class. Fall back to the
 * File node for the scope's filePath so those calls still get an
 * edge source. Matches legacy DAG behavior where module-level CALLS
 * edges originate from the file symbol.
 */
export declare function resolveCallerGraphId(startScope: ScopeId, scopes: ScopeResolutionIndexes, nodeLookup: GraphNodeLookup, atRange?: {
    startLine: number;
    startCol: number;
}): string | undefined;
