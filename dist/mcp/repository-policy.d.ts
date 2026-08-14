import type { LocalBackend } from './local/local-backend.js';
import type { GITNEXUS_TOOLS } from './tools.js';
type GitNexusTool = (typeof GITNEXUS_TOOLS)[number];
interface ResolvedRepository {
    name: string;
    path: string;
    pathKey: string;
}
export declare class McpRepositoryPolicy {
    readonly restricted: boolean;
    readonly configured: boolean;
    private readonly registry;
    private readonly allowed;
    private readonly allowedPathKeys;
    private readonly defaultRepo?;
    private readonly uniqueAllowedContextNames;
    static unrestricted(): McpRepositoryPolicy;
    constructor(registry: readonly ResolvedRepository[], allowed: readonly ResolvedRepository[] | undefined, defaultRepo: ResolvedRepository | undefined);
    private resolveRuntimeRepo;
    private repoForArgs;
    private normalizeToolArgs;
    private listAllowedRepos;
    requiresExplicitRepo(backend: LocalBackend): Promise<boolean>;
    private listReposPage;
    private callTool;
    private resolveRepo;
    assertResourceUri(uri: string): void;
    resourceTemplateAllowed(uriTemplate: string): boolean;
    toolAllowed(toolName: string): boolean;
    toolForMcp(tool: GitNexusTool): GitNexusTool;
    scopeBackend(backend: LocalBackend): LocalBackend;
}
export declare function mcpRepositoryPolicyConfigured(env?: NodeJS.ProcessEnv): boolean;
export declare function createMcpRepositoryPolicy(backend: LocalBackend, env?: NodeJS.ProcessEnv): Promise<McpRepositoryPolicy>;
export {};
