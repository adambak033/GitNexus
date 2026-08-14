/**
 * Build a `(filePath, name) → graphNodeId` lookup over the graph's
 * {@link LINKABLE_LABELS} definition nodes. Two keys per node:
 *
 *   - simple name (`User` / `save`) — legacy fallback
 *   - qualified name when derivable from the node id (`User.save`)
 *
 * The qualified key is the authoritative one when two classes in the
 * same file define a method with the same simple name
 * (`class User: def save` + `class Document: def save`). Without it,
 * the simple-name key collides and every `document.save()` CALLS edge
 * would silently target `User.save`. Method node ids encode the
 * qualifier (`Method:file.py:User.save#1`), so we parse it back out.
 *
 * Language-agnostic seam. Any language provider migrating to the
 * registry-primary path can consume this to translate scope-resolution
 * `SymbolDefinition.nodeId` values into the legacy graph-node ID
 * format that downstream consumers (queries, edges, MCP) expect.
 */
import type { NodeLabel } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
export type GraphNodeLookup = ReadonlyMap<string, string>;
/**
 * Build a qualified-key string in a separate keyspace from simple-key
 * strings. Prefix `<q>` can't appear in a valid filePath on any OS, so
 * no collision between the two keyspaces is possible.
 *
 * Includes the node label so a top-level `def save` (Function,
 * qualifier = `save`) doesn't alias a class method `User.save` (Method,
 * simple name = `save`) whose Function-typed qualifier would collapse
 * to the same simple-key slot in a single map.
 */
export declare function qualifiedKey(filePath: string, label: NodeLabel, qualifiedName: string): string;
/** Simple-name key (legacy fallback keyspace — no `<q>` prefix). */
export declare function simpleKey(filePath: string, name: string): string;
/**
 * Position key: `(filePath, label, 0-based startLine, simple name)` (#2699).
 *
 * The strongest evidence there is, and the only one that needs no name
 * qualification at all — a definition and its graph node are the same
 * construct, so they share a source position. That makes it correct for
 * exactly the cases a name-based key cannot express: a function-local
 * declaration shadowing a file-level one, a local inside an ANONYMOUS
 * function (no name to qualify with), and two same-named declarations in
 * sibling blocks. ECMAScript gives each of those its own environment record;
 * position is what distinguishes them without having to model the chain.
 *
 * Registered only for callable labels, and only when the (line, name) pair is
 * unique in the file — a genuine tie (overloads declared on one line) stores
 * the `AMBIGUOUS_POSITION` tombstone so the caller falls through to the
 * name-based keys rather than picking by source order.
 */
export declare function positionKey(filePath: string, label: NodeLabel, startLine: number, name: string): string;
/**
 * Key recording that a FUNCTION-LOCAL callable with this simple name exists in the
 * file (#2699 follow-up).
 *
 * `resolveDefGraphId`'s last resort is a label-agnostic, first-write-wins
 * `simpleKey(filePath, simpleName)`. That is safe while at most one callable in a file
 * carries a given simple name — but #2699 deliberately creates function-locals that
 * share a name with a file-level callable, and the local's graph node is keyed by
 * position (`run.pick@1:2`) while the scope def is not. When the position join misses —
 * the two id phases anchor on different nodes, so a multiline `const pick =` puts the
 * declaration and its initializer on different lines — the simple-name fallback aliases
 * the local onto whichever same-named callable was registered FIRST and mints a
 * fabricated edge. That is the exact failure class #2693 already shipped once.
 *
 * This lets the resolver fail CLOSED for precisely that case and only that case: if a
 * local of this name exists, a position miss is a genuine ambiguity rather than a lookup
 * gap, so emitting no edge is correct. Files with no such local are untouched, which
 * keeps legitimate anchor differences (e.g. a Vue SFC `lineOffset`) resolving through the
 * name keys exactly as before.
 */
export declare function localNameKey(filePath: string, label: NodeLabel, name: string): string;
/** Tombstone for a position claimed by two nodes — see `positionKey`. */
export declare const AMBIGUOUS_POSITION = "";
export declare function buildGraphNodeLookup(graph: KnowledgeGraph): GraphNodeLookup;
/**
 * Every label {@link buildGraphNodeLookup} registers — and therefore the ONLY
 * labels `resolveDefGraphId` can ever return an id for. Both endpoints of every
 * scope-resolution edge come from that lookup (the one exception is the File
 * fallback in `resolveCallerGraphId`), so this set defines the whole FROM/TO
 * surface those edges can produce.
 *
 * That makes it load-bearing for the LadybugDB relation DDL: a label added here
 * without the matching `FROM x TO y` pairs in `RELATION_SCHEMA` crashes
 * `analyze` at `assertDeclaredPair` on whichever codebase first emits the pair
 * (#2792). `test/unit/schema-pair-coverage.test.ts` derives the required pairs
 * from this set and fails in CI instead.
 */
export declare const LINKABLE_LABELS: ReadonlySet<NodeLabel>;
export declare function isLinkableLabel(label: NodeLabel): boolean;
