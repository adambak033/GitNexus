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
import { collectCppAdlSideChannel, applyCppAdlSideChannel } from './adl.js';
import { collectCppInlineNamespaceSideChannel, applyCppInlineNamespaceSideChannel, } from './inline-namespaces.js';
import { collectCppFileLocalSideChannel, applyCppFileLocalSideChannel, } from './file-local-linkage.js';
import { collectCppTwoPhaseSideChannel, applyCppTwoPhaseSideChannel, } from './two-phase-lookup.js';
import { applyCppMemberLookupSideChannel, collectCppMemberLookupSideChannel, } from './member-lookup.js';
/**
 * `LanguageProvider.collectCaptureSideChannel` implementation for C++.
 * Returns `undefined` when this file recorded no side-channel state at all, so
 * the produced `ParsedFile` carries the field only when there's data to ship.
 */
export function collectCppCaptureSideChannel(filePath) {
    const adl = collectCppAdlSideChannel(filePath);
    const inlineNamespaceRanges = collectCppInlineNamespaceSideChannel(filePath);
    const fileLocal = collectCppFileLocalSideChannel(filePath);
    const twoPhase = collectCppTwoPhaseSideChannel(filePath);
    const memberLookup = collectCppMemberLookupSideChannel(filePath);
    const isEmpty = adl.argInfoBySite.length === 0 &&
        adl.noAdlSites.length === 0 &&
        inlineNamespaceRanges.length === 0 &&
        fileLocal.fileLocalNames.length === 0 &&
        fileLocal.anonymousNamespaceRanges.length === 0 &&
        twoPhase.dependentBases.length === 0 &&
        twoPhase.dependentPackBaseClasses.length === 0 &&
        memberLookup.baseEdges.length === 0 &&
        memberLookup.memberUsings.length === 0;
    if (isEmpty)
        return undefined;
    return { kind: 'cpp', adl, inlineNamespaceRanges, fileLocal, twoPhase, memberLookup };
}
/**
 * `ScopeResolver.applyCaptureSideChannel` implementation for C++. Reads the
 * worker-serialized snapshot from `parsed.captureSideChannel` and writes it
 * back into the module-level maps. Tolerant of `undefined` (file carried no
 * data) and of an unexpected shape (defensive — never throws on a malformed
 * snapshot). Does NO tree-sitter parse.
 */
export function applyCppCaptureSideChannel(parsed) {
    const data = parsed.captureSideChannel;
    if (data === undefined || data === null || typeof data !== 'object')
        return;
    // Discriminant guard — the generic `captureSideChannel` field is shared
    // with C (`{ kind: 'c' }`) and Kotlin (`{ kind: 'kotlin' }`); cleanly
    // ignore a non-C++ payload rather than mis-applying it.
    if (data.kind !== 'cpp')
        return;
    if (data.adl !== undefined)
        applyCppAdlSideChannel(parsed.filePath, data.adl);
    if (data.inlineNamespaceRanges !== undefined) {
        applyCppInlineNamespaceSideChannel(parsed.filePath, data.inlineNamespaceRanges);
    }
    if (data.fileLocal !== undefined)
        applyCppFileLocalSideChannel(parsed.filePath, data.fileLocal);
    if (data.twoPhase !== undefined)
        applyCppTwoPhaseSideChannel(parsed.filePath, data.twoPhase);
    if (data.memberLookup !== undefined) {
        applyCppMemberLookupSideChannel(parsed.filePath, data.memberLookup);
    }
}
