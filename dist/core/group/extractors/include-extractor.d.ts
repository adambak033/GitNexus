import type { ContractExtractor, CypherExecutor } from '../contract-extractor.js';
import type { ExtractedContract, RepoHandle } from '../types.js';
export declare class IncludeExtractor implements ContractExtractor {
    type: "include";
    /**
     * Always returns `true`. NOT called by `sync.ts`, which gates extraction via
     * `config.detect.includes` instead (see `sync.ts:174`). Kept solely to satisfy
     * the `ContractExtractor` interface so the type stays uniform across extractors.
     */
    canExtract(_repo: RepoHandle): Promise<boolean>;
    extract(dbExecutor: CypherExecutor | null, repoPath: string, _repo: RepoHandle): Promise<ExtractedContract[]>;
    /**
     * Discover repo-relative file paths using exactly the same rules the
     * ingestion pipeline uses (`walkRepositoryPaths` in
     * `gitnexus/src/core/ingestion/filesystem-walker.ts`):
     *   - `createIgnoreFilter` honors `.gitignore`, `.gitnexusignore`, the
     *     hardcoded ignore list, and `.gitnexusignore` last-match-wins
     *     negation.
     *   - `getMaxFileSizeBytes()` drops files larger than the cap so we
     *     never emit `File:<rel>` UIDs for files ingestion would skip.
     *
     * Uses sequential stat — there is no `READ_CONCURRENCY` batching here
     * because group sync runs at startup-time, not the ingestion hot path,
     * and parallelism gains are not worth the import-graph weight.
     *
     * MAINTENANCE: if `walkRepositoryPaths` changes its glob options, ignore
     * filter shape, or size-cap logic, mirror those changes here. The two
     * implementations exist because the consumers need different return
     * shapes (string[] vs ScannedFile[]) and different concurrency, but
     * they MUST agree on which files are reachable — that is what makes
     * `File:<rel>` UIDs in cross-links correspond to graph File nodes.
     */
    private discoverIndexableFiles;
    private extractProviders;
    private extractProvidersGraph;
    private extractProvidersFallback;
    private extractConsumers;
    private dedupe;
}
