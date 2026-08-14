import type { CrossLink, GroupManifestLink, StoredContract } from '../types.js';
import type { CypherExecutor } from '../contract-extractor.js';
export interface ManifestExtractResult {
    contracts: StoredContract[];
    crossLinks: CrossLink[];
}
export declare const CUSTOM_CONTRACT_RESOLVE_QUERY = "MATCH (n)\n   WHERE labels(n) IN ['Function','Method','Class','Interface','Struct','Enum','Trait','Constructor','TypeAlias','Impl','Macro','Union','Typedef','Property','Record','Delegate','Annotation','Template','Const','Static','CodeElement']\n     AND n.name = $symbolName\n   RETURN n.id AS uid, n.name AS name, n.filePath AS filePath\n   ORDER BY n.filePath ASC, n.id ASC\n   LIMIT 1";
/**
 * Stable synthetic symbolUid for a manifest-declared contract whose target
 * symbol could not be resolved against the per-repo graph (resolveSymbol
 * returned null). Two reasons we don't leave the uid empty:
 *
 *  1. The bridge stores Contract nodes keyed in part by symbolUid; an empty
 *     uid means downstream Cypher queries that anchor on `provider.symbolUid`
 *     can't tell two different unresolved manifest contracts apart.
 *  2. The cross-impact bridge query in cross-impact.ts joins local impact
 *     results to bridge contracts via `WHERE provider.symbolUid IN $localUids`.
 *     If the local impact engine produces a deterministic identifier for the
 *     unresolved target, it must agree with the value the bridge stored. A
 *     synthetic uid keyed off (repo, contractId) is the only thing both sides
 *     can derive without knowing about each other.
 *
 * Format: `manifest::<repo>::<contractId>`. Stable across syncs, scoped to a
 * single repo within a group, and never collides with real indexer uids
 * (which never start with `manifest::`).
 */
export declare function manifestSymbolUid(repo: string, contractId: string): string;
export declare class ManifestExtractor {
    extractFromManifest(links: GroupManifestLink[], dbExecutors?: Map<string, CypherExecutor>): Promise<ManifestExtractResult>;
    private resolveSymbol;
    /**
     * Build a canonical contract id for a manifest link.
     *
     * HTTP is the only type with two valid forms:
     *   - Explicit method: `"GET::/api/orders"` → `"http::GET::/api/orders"`
     *     (matches exactly against `HttpRouteExtractor` provider/consumer
     *     contracts, which are also keyed by `http::<METHOD>::<path>`).
     *   - Method-agnostic: `"/api/orders"` → `"http::*::/api/orders"`
     *     — the `*` is a wildcard and is intended to match any concrete
     *     HTTP method on that path. Wildcard-aware matching is the
     *     responsibility of the sync / cross-impact layer (see #793);
     *     downstream code should treat `http::*::<path>` as matching
     *     every `http::<METHOD>::<path>` for the same path.
     *
     * Recommend the explicit-method form in group.yaml whenever the
     * manifest author knows the method — it round-trips through exact
     * equality matching without requiring wildcard logic downstream.
     *
     * NOTE on exhaustiveness: the switch covers every current
     * `ContractType` variant and falls through to a `never` assertion so
     * TypeScript fails the build if a new variant is added without a
     * corresponding case.
     */
    private buildContractId;
}
