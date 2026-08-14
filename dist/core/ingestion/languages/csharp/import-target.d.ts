/**
 * Adapter from `(ParsedImport, WorkspaceIndex)` → concrete file path.
 *
 * Unit 2 shape: suffix-match against the repo's `.cs` files. Each
 * `using System.Collections.Generic;` could legally expand to multiple
 * files (every `.cs` that declares `namespace System.Collections.Generic`
 * — partial classes, assembly-wide namespaces). The scope-resolver
 * contract returns a single primary target, so we pick the first
 * match. Cross-file partial-class aggregation runs at graph-bridge
 * time (Unit 6) via `populateOwners`.
 *
 * When `.csproj` configs are available, consults the legacy
 * namespace-directory resolver first. Both that resolver's suffix
 * fallback and the progressive prefix stripping below are gated on
 * declared in-repo namespaces so BCL usings like `System.Threading.Tasks`
 * cannot spuriously match a local `Tasks.cs` (#1881).
 *
 * Returning `null` lets the finalize algorithm mark the edge as
 * `linkStatus: 'unresolved'`.
 */
import type { ParsedImport, WorkspaceIndex } from '../../../../_shared/index.js';
import type { CSharpProjectConfig, CSharpNamespaceEvidence } from '../../language-config.js';
export interface CsharpResolveContext {
    readonly fromFile: string;
    readonly allFilePaths: ReadonlySet<string>;
    readonly csharpConfigs?: readonly CSharpProjectConfig[];
    readonly namespaces?: CSharpNamespaceEvidence;
}
export declare function resolveCsharpImportTarget(parsedImport: ParsedImport, workspaceIndex: WorkspaceIndex): string | null;
