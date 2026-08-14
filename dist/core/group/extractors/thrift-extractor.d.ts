import type { ContractExtractor, CypherExecutor } from '../contract-extractor.js';
import type { ExtractedContract, RepoHandle } from '../types.js';
export interface ThriftServiceInfo {
    namespace: string;
    serviceName: string;
    methods: string[];
    thriftPath: string;
}
export interface ThriftContext {
    namespacesByThrift: Map<string, string>;
    servicesByName: Map<string, ThriftServiceInfo[]>;
}
export declare function thriftMethodContractId(namespace: string, serviceName: string, methodName: string): string;
export declare function thriftServiceContractId(namespace: string, serviceName: string): string;
export declare function buildThriftContext(repoPath: string): Promise<ThriftContext>;
export declare class ThriftExtractor implements ContractExtractor {
    type: "thrift";
    canExtract(_repo: RepoHandle): Promise<boolean>;
    extract(_dbExecutor: CypherExecutor | null, repoPath: string, _repo: RepoHandle): Promise<ExtractedContract[]>;
    private detectionToContract;
    private dedupe;
}
