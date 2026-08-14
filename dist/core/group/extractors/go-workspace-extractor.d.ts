import type { CypherExecutor } from '../contract-extractor.js';
import type { GroupManifestLink } from '../types.js';
interface GoModuleMeta {
    modulePath: string;
    groupPath: string;
    repoPath: string;
    requires: string[];
}
export interface GoWorkspaceResult {
    links: GroupManifestLink[];
    discoveredModules: Map<string, GoModuleMeta>;
}
export declare function extractGoWorkspaceLinks(repos: Record<string, string>, repoPaths: Map<string, string>, _dbExecutors?: Map<string, CypherExecutor>): Promise<GoWorkspaceResult>;
export {};
