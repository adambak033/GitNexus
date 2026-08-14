import type { ParsedImport, WorkspaceIndex } from '../../../../_shared/index.js';
export interface KotlinResolveContext {
    readonly fromFile: string;
    readonly allFilePaths: ReadonlySet<string>;
}
export declare function resolveKotlinImportTarget(parsedImport: ParsedImport, workspaceIndex: WorkspaceIndex): string | readonly string[] | null;
