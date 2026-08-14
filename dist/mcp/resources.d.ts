/**
 * MCP Resources (Multi-Repo)
 *
 * Provides structured on-demand data to AI agents.
 * All resources use repo-scoped URIs: gitnexus://repo/{name}/context
 */
import type { LocalBackend } from './local/local-backend.js';
export interface ResourceDefinition {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
}
export interface ResourceTemplate {
    uriTemplate: string;
    name: string;
    description: string;
    mimeType: string;
}
/**
 * Static resources — includes per-repo resources and the global repos list
 */
export declare function getResourceDefinitions(): ResourceDefinition[];
/**
 * Dynamic resource templates
 */
export declare function getResourceTemplates(): ResourceTemplate[];
/** Query parameters for `gitnexus://group/{name}/contracts` */
export type GroupContractsResourceFilter = {
    type?: string;
    repo?: string;
    unmatchedOnly?: boolean;
};
/** Normalized parse result for GitNexus MCP resource URIs */
export type ParsedGitnexusResource = {
    kind: 'repos';
} | {
    kind: 'setup';
} | {
    kind: 'repo';
    repoName: string;
    resourceType: string;
    param?: string;
} | {
    kind: 'group';
    groupName: string;
    resourceType: 'contracts';
    contractsFilter: GroupContractsResourceFilter;
} | {
    kind: 'group';
    groupName: string;
    resourceType: 'status';
};
/**
 * Parse a GitNexus resource URI (repos, setup, per-repo, or per-group templates).
 * Used by `readResource` and tests (round-trip / dispatch coverage).
 */
export declare function parseResourceUri(uri: string): ParsedGitnexusResource;
/**
 * Read a resource and return its content
 */
export declare function readResource(uri: string, backend: LocalBackend): Promise<string>;
