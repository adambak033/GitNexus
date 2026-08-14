/**
 * C++ capture-time side-channel serialization (#1983).
 *
 * `emitCppScopeCaptures` populates several MODULE-LEVEL maps as a side effect
 * that are NOT part of the returned `ParsedFile`'s scopes/defs:
 *
 *   - `argInfoBySite` / `noAdlSites`            (adl.ts)
 *   - `inlineNamespaceRangesByFile`             (inline-namespaces.ts)
 *   - `fileLocalNames` / `anonymousNamespaceRangesByFile` (file-local-linkage.ts)
 *   - `dependentBasesByFile` / `dependentPackBaseClassesByFile` (two-phase-lookup.ts)
 *
 * On the worker path those maps are filled in the WORKER process and lost
 * across the worker→main MessageChannel (and the disk-backed parsedfile-store),
 * because scope-resolution reuses the serialized `ParsedFile` and SKIPS the
 * main-thread re-extraction — the entire point of #1983 is to avoid a
 * main-thread tree-sitter re-parse on huge `.h`/`.cpp` repos (the OOM).
 *
 * This module snapshots the per-file slice of those maps into a plain,
 * JSON-serializable object (carried on `ParsedFile.captureSideChannel`) and
 * restores it on the main thread WITHOUT any parse. It is the data-only
 * replacement for the removed re-parse `replayCaptureSideChannel` hook.
 *
 * The derived state each `populateOwners` / `populateWorkspaceOwners` pass
 * builds (resolved scope-id Sets, `dependentBaseNodeIds`, etc.) is recomputed
 * on the main thread from these restored capture-time maps, so only the
 * capture-time maps need to cross the boundary.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import { type CppAdlSideChannel } from './adl.js';
import { type CppFileLocalSideChannel } from './file-local-linkage.js';
import { type CppTwoPhaseSideChannel } from './two-phase-lookup.js';
import { type CppMemberLookupSideChannel } from './member-lookup.js';
/**
 * Plain JSON-serializable composite of every C++ capture-time side-channel
 * slice for one file. Carried opaquely on `ParsedFile.captureSideChannel`.
 */
export interface CppCaptureSideChannel {
    /**
     * Discriminant tag — the single generic `ParsedFile.captureSideChannel`
     * field is shared with C (`{ kind: 'c' }`) and Kotlin (`{ kind: 'kotlin' }`).
     * `applyCppCaptureSideChannel` checks this first so a foreign-language
     * payload reaching the C++ apply (or vice-versa) is cleanly ignored. In
     * practice apply only runs for the matching provider (one language per file),
     * but the tag makes it robust and consistent with the C/Kotlin snapshots.
     */
    readonly kind: 'cpp';
    readonly adl: CppAdlSideChannel;
    /** Inline-namespace source-range keys recorded for this file. */
    readonly inlineNamespaceRanges: readonly string[];
    readonly fileLocal: CppFileLocalSideChannel;
    readonly twoPhase: CppTwoPhaseSideChannel;
    readonly memberLookup: CppMemberLookupSideChannel;
}
/**
 * `LanguageProvider.collectCaptureSideChannel` implementation for C++.
 * Returns `undefined` when this file recorded no side-channel state at all, so
 * the produced `ParsedFile` carries the field only when there's data to ship.
 */
export declare function collectCppCaptureSideChannel(filePath: string): CppCaptureSideChannel | undefined;
/**
 * `ScopeResolver.applyCaptureSideChannel` implementation for C++. Reads the
 * worker-serialized snapshot from `parsed.captureSideChannel` and writes it
 * back into the module-level maps. Tolerant of `undefined` (file carried no
 * data) and of an unexpected shape (defensive — never throws on a malformed
 * snapshot). Does NO tree-sitter parse.
 */
export declare function applyCppCaptureSideChannel(parsed: ParsedFile): void;
