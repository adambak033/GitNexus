import type { CypherExecutor } from '../contract-extractor.js';
import type { GroupManifestLink } from '../types.js';
interface PythonPackageMeta {
    name: string;
    importName: string;
    groupPath: string;
    repoPath: string;
    workspaceDeps: string[];
}
export interface PythonWorkspaceResult {
    links: GroupManifestLink[];
    discoveredPackages: Map<string, PythonPackageMeta>;
}
export declare function extractPythonWorkspaceLinks(repos: Record<string, string>, repoPaths: Map<string, string>, _dbExecutors?: Map<string, CypherExecutor>): Promise<PythonWorkspaceResult>;
export {};
