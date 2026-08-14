import type { CypherExecutor } from '../contract-extractor.js';
import type { GroupManifestLink } from '../types.js';
export interface WorkspaceDiscoveryResult {
    links: GroupManifestLink[];
    stats: WorkspaceExtractorStats[];
}
interface WorkspaceExtractorStats {
    ecosystem: string;
    linkCount: number;
    projectCount: number;
}
export declare function discoverWorkspaceLinks(repos: Record<string, string>, repoPaths: Map<string, string>, dbExecutors?: Map<string, CypherExecutor>): Promise<WorkspaceDiscoveryResult>;
export {};
