/**
 * Adapter from `(ParsedImport, WorkspaceIndex)` → concrete file path.
 *
 * Delegates to the existing `resolvePythonImportInternal` (PEP-328
 * relative resolution + standard suffix matching). The `WorkspaceIndex`
 * is opaque at this layer; consumers wire a `PythonResolveContext`
 * shape carrying `fromFile` + `allFilePaths`.
 *
 * Returning `null` lets the finalize algorithm mark the edge as
 * `linkStatus: 'unresolved'`.
 */
import type { ParsedFile, ParsedImport, WorkspaceIndex } from '../../../../_shared/index.js';
export interface PythonResolveContext {
    readonly fromFile: string;
    /** `ReadonlySet` so the orchestrator's stable run-level set flows straight
     *  through to `getPythonFileIndex`'s `WeakMap` key (built once per run, not
     *  copied per import). The whole resolver chain only reads the set. */
    readonly allFilePaths: ReadonlySet<string>;
    /** Optional parsed workspace used to preserve a package's explicit export
     * when it collides with a same-named concrete submodule. */
    readonly parsedFiles?: readonly ParsedFile[];
}
export declare function resolvePythonImportTarget(parsedImport: ParsedImport, workspaceIndex: WorkspaceIndex): string | null;
/**
 * A named Python import is a namespace handle only when its resolved file is
 * the concrete submodule formed by appending the imported name. This keeps
 * ordinary symbol imports on the named-binding path.
 */
export declare function isPythonImportedModule(parsedImport: ParsedImport, targetFile: string, fromFile: string): boolean;
/**
 * The receiver spellings `import a.b.c` makes callable, and the file each one
 * names (#2826).
 *
 * `import a.b.c` binds ONE name — `a` — but makes three attribute paths
 * reachable, and they name three different files:
 *
 *   a        → a/__init__.py
 *   a.b      → a/b/__init__.py
 *   a.b.c    → a/b/c.py        (the edge's own target)
 *
 * The shared default keyed `a` to the LEAF, which is wrong in both directions:
 * `a.helper()` resolved into `a/b/c.py` whenever that module happened to export
 * `helper`, and `a.b.mid()` resolved to nothing.
 *
 * Returns `undefined` — meaning "use the shared default" — for every spelling
 * where the bound name is not the path's root:
 *   - `import single`            — no dotted path to expand;
 *   - `import a.b as x`          — binds only `x`; writing `a.b.f()` there is a
 *                                  NameError, so `a.b` must NOT become a key;
 *   - `from pkg import db`       — reclassified to a namespace edge whose
 *                                  importPath is the bare name `db`.
 *
 * Prefix files are proposed, not asserted: `moduleFileExists` drops any that
 * the workspace did not parse, so a PEP-420 namespace package (no
 * `__init__.py`) contributes no key rather than one pointing at a missing file.
 */
export declare function pythonNamespaceReceiverPaths(edge: {
    readonly localName: string;
    readonly importPath: string;
    readonly targetFile: string;
}, moduleFileExists: (filePath: string) => boolean): readonly (readonly [string, string])[] | undefined;
