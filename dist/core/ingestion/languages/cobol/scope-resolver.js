/**
 * COBOL `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed
 * by the generic `runScopeResolution` orchestrator.
 *
 * The provider is a thin wiring object — COBOL's simple scope model
 * (Module + Function only, no inheritance, no type system) plugs into
 * `runScopeResolution` with minimal configuration.
 *
 * Reference: `languages/python/scope-resolver.ts`.
 */
import path from 'node:path';
import { SupportedLanguages } from '../../../../_shared/index.js';
import { perFileSet } from '../../import-resolvers/per-file-set.js';
import { populateClassOwnedMembers } from '../../scope-resolution/scope/walkers.js';
import { cobolProvider } from '../cobol.js';
// Copybook file extensions for COPY name resolution
const COPYBOOK_EXTENSIONS = new Set(['.cpy', '.copybook']);
// COBOL source files, searched only after every copybook has missed.
const COBOL_SOURCE_EXTENSIONS = new Set(['.cbl', '.cob', '.cobol']);
const getCobolCopyIndex = perFileSet((allFilePaths) => {
    const copybooks = new Map();
    const sources = new Map();
    // One pass builds both tiers: the two scans walked the same files and
    // classified each by the same extension test.
    for (const fp of allFilePaths) {
        const ext = path.extname(fp).toLowerCase();
        const tier = COPYBOOK_EXTENSIONS.has(ext)
            ? copybooks
            : COBOL_SOURCE_EXTENSIONS.has(ext)
                ? sources
                : undefined;
        if (tier === undefined)
            continue;
        const basename = path.basename(fp, ext).toUpperCase();
        // First in Set-iteration order wins, as the scans' first-match `return` did.
        if (!tier.has(basename))
            tier.set(basename, fp);
    }
    return { copybooks, sources };
});
const cobolScopeResolver = {
    language: SupportedLanguages.Cobol,
    languageProvider: cobolProvider,
    importEdgeReason: 'cobol-scope: copy',
    // ── Resolve COPY bookname to file path ─────────────────────────────
    resolveImportTarget: (targetRaw, _fromFile, allFilePaths) => {
        const upper = targetRaw.toUpperCase();
        const index = getCobolCopyIndex(allFilePaths);
        // Copybooks first, then COBOL sources — the tier order IS the tie-break.
        return index.copybooks.get(upper) ?? index.sources.get(upper) ?? null;
    },
    // COBOL has no binding-merge rules beyond the default (local-first-then-imports).
    mergeBindings: (existing) => [...existing],
    // COBOL arity: compare CALL USING param count against def's parameterCount.
    // COBOL requires exact arity match for CALL USING.
    arityCompatibility: (callsite, def) => {
        if (callsite.arity === undefined)
            return 'unknown';
        const defParamCount = def.parameterCount;
        if (defParamCount === undefined)
            return 'unknown';
        if (callsite.arity === defParamCount)
            return 'compatible';
        return 'incompatible';
    },
    // PROGRAM-ID declarations bridge to legacy Module graph nodes. COBOL's
    // procedure-pointer ENTRY values therefore target Module defs, while every
    // AST-backed provider keeps the shared callable-label default.
    isCallableValueTarget: (def) => def.type === 'Module',
    // Structural COBOL CALLS/IMPORTS remain owned by the established regex
    // processor; this resolver contributes only procedure-pointer CALLS.
    scopeResolutionEdgeMode: 'callable-flow-only',
    // No inheritance in COBOL — empty MRO map.
    buildMro: () => new Map(),
    // Everything lives under the PROGRAM-ID Module scope.
    populateOwners: (parsed) => populateClassOwnedMembers(parsed),
    // COBOL has no super calls.
    isSuperReceiver: () => false,
    // ── Optional toggles ─────────────────────────────────────────────
    fieldFallbackOnMethodLookup: false,
    propagatesReturnTypesAcrossImports: false,
};
export { cobolScopeResolver };
