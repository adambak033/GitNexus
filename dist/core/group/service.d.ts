/**
 * Group orchestration shared by MCP (LocalBackend) and CLI.
 * DB access is injected via GroupToolPort so this module stays free of LocalBackend private API.
 */
import type { GroupContextResult } from './types.js';
export interface GroupRepoHandle {
    id: string;
    name: string;
    repoPath: string;
    storagePath: string;
    indexedAt?: string;
    lastCommit?: string;
}
export interface GroupToolPort {
    resolveRepo(repoParam?: string): Promise<GroupRepoHandle>;
    impact(repo: GroupRepoHandle, params: {
        target: string;
        direction: 'upstream' | 'downstream';
        maxDepth?: number;
        relationTypes?: string[];
        includeTests?: boolean;
        minConfidence?: number;
        limit?: number;
    }): Promise<unknown>;
    query(repo: GroupRepoHandle, params: {
        query: string;
        task_context?: string;
        goal?: string;
        limit?: number;
        max_symbols?: number;
        include_content?: boolean;
    }): Promise<unknown>;
    impactByUid(repoId: string, uid: string, direction: string, opts: {
        maxDepth: number;
        relationTypes: string[];
        minConfidence: number;
        includeTests: boolean;
        signal?: AbortSignal;
    }): Promise<unknown | null>;
    context(repo: GroupRepoHandle, params: {
        name?: string;
        uid?: string;
        file_path?: string;
        include_content?: boolean;
    }): Promise<unknown>;
    trace?(repo: GroupRepoHandle, params: {
        from?: string;
        to?: string;
        from_uid?: string;
        to_uid?: string;
        from_file?: string;
        to_file?: string;
        maxDepth?: number;
        includeTests?: boolean;
    }): Promise<unknown>;
    resolveSymbol?(repo: GroupRepoHandle, query: {
        name?: string;
        uid?: string;
        file_path?: string;
    }): Promise<GroupSymbolResolution>;
    pdgFlows?(repo: GroupRepoHandle, anchor: {
        name?: string;
        uid?: string;
        file_path?: string;
    }, opts: {
        limit?: number;
    }): Promise<GroupPdgFlowResult>;
}
export type GroupSymbolResolution = {
    kind: 'ok';
    symbol: {
        id: string;
        name: string;
        type: string;
        filePath: string;
        startLine: number;
        endLine: number;
    };
} | {
    kind: 'ambiguous';
    candidates: Array<{
        id: string;
        name: string;
        type: string;
        filePath: string;
        startLine: number;
    }>;
} | {
    kind: 'not_found';
};
export interface GroupPdgFlowHop {
    line: number;
    text: string;
    variable?: string;
}
export interface GroupPdgFlowResult {
    available: boolean;
    variable?: string;
    hops: GroupPdgFlowHop[];
    truncated?: boolean;
}
export declare class GroupService {
    private readonly port;
    constructor(port: GroupToolPort);
    groupList(params: Record<string, unknown>): Promise<unknown>;
    groupSync(params: Record<string, unknown>): Promise<unknown>;
    groupContracts(params: Record<string, unknown>): Promise<unknown>;
    groupImpact(params: Record<string, unknown>): Promise<unknown>;
    groupTrace(params: Record<string, unknown>): Promise<unknown>;
    groupContext(params: Record<string, unknown>): Promise<GroupContextResult>;
    groupQuery(params: Record<string, unknown>): Promise<unknown>;
    groupStatus(params: Record<string, unknown>): Promise<unknown>;
}
