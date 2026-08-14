/**
 * Tag C# file-level type defs with their enclosing-namespace path on the
 * sidecar `namespacePrefix` field — WITHOUT touching `qualifiedName` (mutating
 * it corrupts simple-name heritage / base resolution; #2046 regression).
 *
 * `tagNamespacePrefixes` (shared) only reaches defs whose scope chain includes
 * a Namespace scope. C# file-scoped `namespace X;` gives the Namespace scope a
 * 1-line range, so top-level types land under the Module scope and are missed.
 * This pass covers both block- and file-scoped namespaces so the qualified
 * constructor resolver can break a same-tail collision (`new B.Foo()` with both
 * `A.Foo` and `B.Foo`) by matching the explicit qualifier against the sidecar.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
export declare function populateCsharpNamespacePrefixes(parsed: ParsedFile): void;
