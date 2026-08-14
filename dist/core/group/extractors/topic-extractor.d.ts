import type { ContractExtractor, CypherExecutor } from '../contract-extractor.js';
import type { ExtractedContract, RepoHandle } from '../types.js';
export declare class TopicExtractor implements ContractExtractor {
    type: "topic";
    canExtract(_repo: RepoHandle): Promise<boolean>;
    extract(_dbExecutor: CypherExecutor | null, repoPath: string, _repo: RepoHandle): Promise<ExtractedContract[]>;
    private dedupe;
}
