/**
 * Last-resort property resolution by UNIQUE NAME (A1/A5).
 *
 * Idiomatic JS reads configuration off a plain object whose receiver cannot be
 * typed — an options bag passed as a parameter, a destructured handle, an
 * imported literal. The precise passes resolve none of those, so a field read
 * and written across a live code path produced no `ACCESSES` edge at all and
 * "who reads this setting?" answered a confident zero.
 *
 * This pass runs AFTER every precise pass and only sees what they left behind.
 * For each still-unresolved read/write site it asks one question: does exactly
 * ONE `Property` node in the graph carry this name? If so the read almost
 * certainly means it, and an edge is emitted at REDUCED CONFIDENCE with a
 * reason that names the inference. If two or more carry the name, nothing is
 * emitted — a guess between them would be a coin flip, and a wrong edge in the
 * pre-edit safety gate is worse than a missing one.
 *
 * Why uniqueness is the right gate: the names this recovers are the ones worth
 * recovering. Distinctive domain fields (`exitMinAtrMult`, `bookNotionalUsdt`)
 * are unique in a repo and resolve; generic keys (`id`, `name`, `data`) are not
 * and are skipped, which is exactly where name matching would over-connect.
 * That is the `fieldFallbackOnMethodLookup` trade this codebase already accepts
 * for dynamic languages, bounded so it cannot fire on the ambiguous majority.
 *
 * Confidence is 0.5 — the same tier the 3-tier import resolver assigns its
 * global fallback, because this is the same kind of claim: a name matched
 * workspace-wide with no scope evidence behind it.
 *
 * ── R2: workspace uniqueness is too blunt on its own ────────────────────────
 *
 * Measured on the repo this pass was written for: `exitMinAtrMult` has 26
 * `Property` definitions — 16 of them in one-off `scripts/`, 7 in the frontend,
 * one in a test, and exactly ONE in the backend that actually reads it. Strict
 * uniqueness declined every backend read because research scripts the backend
 * has no relationship with each carry a same-named key. The gate was not
 * wrong, it was scope-blind: it compared against the whole workspace when the
 * reader can only plausibly mean something it can SEE.
 *
 * So a name with several definitions is now narrowed before being abandoned:
 *   Tier 1 — a definition in the READING FILE itself.
 *   Tier 2 — a definition in a file the reading file DIRECTLY IMPORTS.
 * Exactly one survivor at the first non-empty tier resolves; anything else is
 * still refused. Narrowing uses the finalized import graph, so it is real
 * evidence rather than a path-shape heuristic, and it is language-neutral.
 *
 * A tier that finds SEVERAL candidates stops the walk instead of falling
 * through to the next one. Two same-named keys in the reading file mean the
 * read is genuinely ambiguous where the reader is standing; reaching past them
 * to an imported file would answer a question the local evidence already
 * contradicts.
 *
 * Confidence stays 0.5 for every tier. Narrowing improves which candidate is
 * chosen, not the kind of claim being made — it is still a name match, and the
 * round-1 contract is that a consumer filtering on confidence can drop all
 * name inference without dropping scope-resolved edges. The reason string
 * records which tier fired.
 *
 * WHY GRAPH NODES, NOT SCOPE DEFS: an object-literal key mints a `Property`
 * NODE (parse query) but no scope-resolution DEF, so `scope.bindings` and
 * `localDefs` are both empty for exactly the population this pass exists to
 * serve. Indexing the graph is therefore not a shortcut — it is the only place
 * these symbols exist. It also means the pass emits straight to the graph
 * rather than through `tryEmitEdge`, whose target side takes a def.
 */
import type { ImportEdge, ParsedFile, ScopeId } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
interface PropertyCandidate {
    readonly id: string;
    readonly filePath: string;
    /**
     * True when this definition is the RETURN SHAPE of a function (R3-4) rather
     * than a declared surface — a named object literal, a class field, an
     * interface or alias member.
     *
     * Return shapes are the weaker anchor and are ranked below declared ones, so
     * adding them cannot change an answer that already resolved. That is what
     * reconciles this with R2-1b, which deliberately modelled returned keys as
     * WRITES to avoid adding same-named competitors to narrowing: they are
     * definitions now, but they never outrank a real declaration, so the
     * competitor problem it was avoiding does not come back.
     */
    readonly fromReturnShape: boolean;
}
/**
 * The only part of the finalized scope model this pass reads. Narrowed to a
 * structural type so the pass does not depend on the full finalize result.
 */
interface FinalizedImportView {
    readonly imports: ReadonlyMap<ScopeId, readonly ImportEdge[]>;
}
export interface UniqueNamePropertyStats {
    /** Edges emitted from a name match at any tier. */
    readonly emitted: number;
    /**
     * Sites skipped because the name could not be narrowed to one definition,
     * so a match would have been a coin flip. Reported rather than silently
     * dropped: this is the population a receiver-typing improvement would
     * convert into precise edges.
     */
    readonly ambiguous: number;
    /**
     * Of {@link emitted}, how many needed scope narrowing — the name carried
     * several definitions and same-file or direct-import evidence picked one.
     * Strict workspace uniqueness would have refused every one of these.
     */
    readonly narrowed: number;
    /**
     * The distinct names behind {@link ambiguous}, capped. A bare count says a
     * gap exists; the names say WHICH fields are unanswerable, which is the
     * difference between a metric and something a reader can act on.
     */
    readonly ambiguousNames: readonly string[];
    /**
     * Read/write sites whose name IS defined in the workspace, but only in
     * ANOTHER language — so per-language inference correctly declined, and the
     * caller got an empty result byte-identical to "this field is unused".
     *
     * Keeping this separate from {@link ambiguous} matters: ambiguity means the
     * analyzer saw several candidates and refused to choose, while this means it
     * saw candidates it was not allowed to consider. The remedies differ — one
     * wants better receiver typing, the other wants an anchor in this language
     * (or a text search) — so collapsing them would tell a reader the wrong thing
     * to do.
     */
    readonly crossLanguageOnly: number;
    /**
     * The distinct names behind {@link crossLanguageOnly}, capped, each with the
     * languages its definitions actually live in. That is the actionable half:
     * "wickRatio is defined only in TypeScript" tells a reader why their
     * JavaScript query came back empty and what to do about it.
     */
    readonly crossLanguageOnlyNames: readonly {
        readonly name: string;
        readonly languages: string[];
    }[];
}
/**
 * Every `Property` node in the graph, grouped by name.
 *
 * WHOLE-GRAPH AND LANGUAGE-AGNOSTIC, so it is built ONCE by the caller and
 * shared across every language pass — the same treatment `sharedNodeLookup` and
 * `sharedFnNodeIndex` already get in `phase.ts`, and for the same reason: a
 * per-language rebuild scans every node in the repo N times, and on a large
 * repo a small language's full copy overlaps the next language's.
 *
 * Deliberately NOT capped here. The cap belongs after the language filter (see
 * {@link candidatesForLanguage}) — a name carried by forty properties across a
 * polyglot monorepo but only two in the language being resolved is answerable,
 * and capping globally would refuse it. One entry per Property node is the same
 * order as the node-lookup map built beside it.
 */
export type PropertyNameIndex = ReadonlyMap<string, readonly PropertyCandidate[]>;
export declare function buildPropertyNameIndex(graph: KnowledgeGraph): PropertyNameIndex;
export declare function emitUniqueNamePropertyAccesses(graph: KnowledgeGraph, indexes: ScopeResolutionIndexes, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, 
/** Sites a precise pass already owns — never second-guessed here. */
skipSites: ReadonlySet<string>, 
/** Finalized import graph; narrows a name carried by several definitions. */
finalized?: FinalizedImportView, 
/**
 * Whole-graph `Property`-by-name index built ONCE by the caller and shared
 * across every language pass. It is a full node scan and language-agnostic,
 * so rebuilding it per language repeats that scan N times — the pattern
 * `phase.ts` already hoisted out for `sharedNodeLookup`. Built locally when
 * omitted (tests / isolated calls).
 */
prebuiltPropertyNameIndex?: PropertyNameIndex, 
/**
 * DETECT WITHOUT EMITTING. A language that sets
 * `fieldFallbackOnMethodLookup: false` (TypeScript) opts out of name
 * inference because a real type system should answer precisely — that opt-out
 * is right and stays. But skipping the pass wholesale also skipped its
 * REPORTING, so a TypeScript read whose only anchor is JavaScript got the
 * same silent empty answer R3-1 exists to remove, just in the other
 * direction. Detection is not inference: counting what could not be linked
 * asserts nothing about what it means.
 */
reportOnly?: boolean): UniqueNamePropertyStats;
export {};
