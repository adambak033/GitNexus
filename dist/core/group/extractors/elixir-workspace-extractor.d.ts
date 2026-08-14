import type { CypherExecutor } from '../contract-extractor.js';
import type { GroupManifestLink } from '../types.js';
interface ElixirAppMeta {
    appName: string;
    modulePrefix: string;
    groupPath: string;
    repoPath: string;
    deps: string[];
}
export interface ElixirWorkspaceResult {
    links: GroupManifestLink[];
    discoveredApps: Map<string, ElixirAppMeta>;
}
export declare function extractElixirWorkspaceLinks(repos: Record<string, string>, repoPaths: Map<string, string>, _dbExecutors?: Map<string, CypherExecutor>): Promise<ElixirWorkspaceResult>;
export {};
