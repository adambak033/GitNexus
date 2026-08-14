import type { ContractExtractor, CypherExecutor } from '../contract-extractor.js';
import type { ExtractedContract, RepoHandle } from '../types.js';
/**
 * Language-agnostic orchestrator for HTTP route (provider + consumer)
 * contract extraction. Two strategies, in order of preference per role:
 *
 * 1. **Graph-assisted (Strategy A)** — if a per-repo LadybugDB executor
 *    is available, read `HANDLES_ROUTE` / `FETCHES` Cypher edges that
 *    the ingestion pipeline already produced via tree-sitter. This is
 *    the preferred path because the graph has richer symbol metadata
 *    (real uids, class/method structure, etc.).
 *
 * 2. **Source-scan supplement (Strategy B)** — parse files directly with
 *    the per-language plugin registry in `./http-patterns/`. Used to
 *    fill gaps when graph extraction only covers part of a polyglot repo
 *    (e.g. Java graph routes plus Go source-scan routes). Graph entries
 *    remain authoritative for duplicate contract IDs because they carry
 *    richer symbol metadata. Each plugin owns its tree-sitter grammar
 *    and query sources — this orchestrator imports NO grammars or query
 *    strings.
 *
 * Adding a new language for Strategy B is a one-file edit in
 * `http-patterns/index.ts`: register a new `HttpLanguagePlugin` and
 * widen `HTTP_SCAN_GLOB` if needed.
 */
export declare const HANDLES_ROUTE_QUERY = "\nMATCH (handlerFile:File)-[r:CodeRelation {type: 'HANDLES_ROUTE'}]->(route:Route)\nRETURN handlerFile.id AS fileId, handlerFile.filePath AS filePath,\n       route.name AS routePath, route.id AS routeId,\n       route.method AS routeMethod,\n       route.handlerSymbolId AS handlerSymbolId,\n       route.responseKeys AS responseKeys,\n       r.reason AS routeSource";
export declare const RESOLVE_BY_NAME_QUERY = "\nMATCH (n) WHERE labels(n) IN ['Function','Method','CodeElement']\n  AND n.name = $name AND n.filePath <> ''\nRETURN n.id AS uid, n.name AS name, n.filePath AS filePath\nLIMIT 2";
export declare const RESOLVE_IN_MODULE_QUERY = "\nMATCH (n) WHERE labels(n) IN ['Function','Method','CodeElement']\n  AND n.name = $name AND (n.filePath STARTS WITH $fileDot OR n.filePath STARTS WITH $fileSlash)\nRETURN n.id AS uid, n.name AS name, n.filePath AS filePath\nLIMIT 2";
/**
 * Canonicalize a provider-side HTTP path for contract-id generation:
 *   - strip query string
 *   - lower-case
 *   - drop trailing slash
 *   - collapse `:id`, `{id}`, `[id]` path params into a single `{param}`
 */
export declare function normalizeHttpPath(p: string): string;
export declare function normalizeRepoRelPath(filePath: string): string;
export declare class HttpRouteExtractor implements ContractExtractor {
    type: "http";
    canExtract(_repo: RepoHandle): Promise<boolean>;
    extract(dbExecutor: CypherExecutor | null, repoPath: string, _repo: RepoHandle): Promise<ExtractedContract[]>;
    private scanFiles;
    private extractProvidersGraph;
    private extractProvidersSourceScan;
    private extractConsumersGraph;
    private extractConsumersSourceScan;
    private dedupeContracts;
    private mergeGraphAndSourceContracts;
}
