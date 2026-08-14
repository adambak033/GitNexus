import type { CypherExecutor } from '../contract-extractor.js';
import type { GroupManifestLink } from '../types.js';
interface JavaProjectMeta {
    groupId: string;
    artifactId: string;
    basePackage: string;
    groupPath: string;
    repoPath: string;
    deps: string[];
}
export interface JavaWorkspaceResult {
    links: GroupManifestLink[];
    discoveredProjects: Map<string, JavaProjectMeta>;
}
export declare function extractJavaWorkspaceLinks(repos: Record<string, string>, repoPaths: Map<string, string>, _dbExecutors?: Map<string, CypherExecutor>): Promise<JavaWorkspaceResult>;
export {};
