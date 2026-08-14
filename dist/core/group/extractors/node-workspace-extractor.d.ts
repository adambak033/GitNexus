import type { CypherExecutor } from '../contract-extractor.js';
import type { GroupManifestLink } from '../types.js';
interface PackageMeta {
    name: string;
    groupPath: string;
    repoPath: string;
    workspaceDeps: string[];
}
export interface NodeWorkspaceResult {
    links: GroupManifestLink[];
    discoveredPackages: Map<string, PackageMeta>;
}
export declare function extractNodeWorkspaceLinks(repos: Record<string, string>, repoPaths: Map<string, string>, _dbExecutors?: Map<string, CypherExecutor>): Promise<NodeWorkspaceResult>;
export {};
