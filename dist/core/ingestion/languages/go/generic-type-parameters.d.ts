import type { ParsedFile, SymbolDefinition } from '../../../../_shared/index.js';
/**
 * Stamp every generic interface in `parsedFiles` with its type-parameter names,
 * read out of the declaration's own source text.
 *
 * WHY SOURCE TEXT AND NOT A CAPTURE. The tree has the list right there
 * (`type_spec` carries a `type_parameters` field), and capturing it would be two
 * lines. But captures run inside the PARSE WORKER, whose script is resolved from
 * the compiled `dist/` build, and their output is additionally memoized by the
 * parse cache and the durable ParsedFile store — so a capture-side change is
 * invisible until a rebuild AND a cache-version bump, and silently wrong in
 * between. Everything here runs on the main thread from data the pipeline
 * already materialized, so it is correct on the first run and needs neither.
 *
 * The scan is exact rather than a grep over the file: an interface declaration
 * owns a `Class` scope whose range spans exactly its `type_spec`
 * (`Repo[T any] interface{ … }`), so the text is sliced by that range and the
 * type parameters are, by grammar, whatever sits between the brackets that
 * IMMEDIATELY follow the name. Comments and strings elsewhere in the file cannot
 * reach it.
 */
export declare function stampGoInterfaceTypeParameters(parsedFiles: readonly ParsedFile[], fileContents: ReadonlyMap<string, string>): void;
/** Read back a stamp, rejecting anything whose shape does not match — the
 *  sidecar is optional and a hand-built fixture def carries none. */
export declare function readGoTypeParameters(def: SymbolDefinition): readonly string[] | undefined;
/** Index of the delimiter closing the one at `open`, or -1 when unbalanced.
 *  Tracks `[]`, `{}` and `()` together so an `interface{ M(a, b int) }`
 *  constraint cannot end the list early. */
export declare function matchingGoDelimiter(text: string, open: number): number;
/** Split on commas that are not nested inside brackets, braces or parens. */
export declare function splitTopLevelGoList(text: string): string[];
