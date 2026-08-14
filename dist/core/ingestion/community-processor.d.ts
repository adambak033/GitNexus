/**
 * Community Detection Processor
 *
 * Uses the Leiden algorithm (via graphology-communities-leiden) to detect
 * communities/clusters in the code graph based on CALLS relationships.
 *
 * Communities represent groups of code that work together frequently,
 * helping agents navigate the codebase by functional area rather than file structure.
 */
import type { AbstractGraph, Attributes } from 'graphology-types';
import type { NodeLabel } from '../../_shared/index.js';
import { KnowledgeGraph } from '../graph/types.js';
/** Graphology Graph instance type (AbstractGraph from graphology-types avoids CJS/ESM interop namespace issue) */
type GraphInstance = AbstractGraph<Attributes, Attributes, Attributes>;
type CommunityEngine = 'graphology' | 'icebug';
export type CommunityDetectionEngine = CommunityEngine | 'auto';
export interface CommunityDetectionOptions {
    /**
     * Graphology is the supported default. `icebug`/`auto` are **experimental**:
     * they route through the optional `@ladybugmem/icebug` native Leiden (#2337)
     * and fall back to Graphology if it is not installed, cannot load, or
     * predates the thread/seed controls determinism requires. The two engines
     * partition differently, so switching changes community IDs — and with them
     * any generated context keyed on those IDs. No stability guarantee.
     */
    engine?: CommunityDetectionEngine;
    icebug?: {
        threads?: number;
        seed?: number;
        iterations?: number;
        gamma?: number;
        randomize?: boolean;
    };
}
export interface CommunityProjectionNode {
    id: string;
    name: unknown;
    filePath: unknown;
    type: NodeLabel;
}
export interface CommunityProjection {
    nodes: CommunityProjectionNode[];
    edges: Array<readonly [number, number]>;
    symbolCount: number;
    isLarge: boolean;
}
export interface CommunityCsr {
    indptr: BigUint64Array;
    indices: BigUint64Array;
}
export declare const resolveCommunityDetectionEngine: (raw?: string) => CommunityDetectionEngine;
export interface CommunityNode {
    id: string;
    label: string;
    heuristicLabel: string;
    cohesion: number;
    symbolCount: number;
}
export interface CommunityMembership {
    nodeId: string;
    communityId: string;
}
export interface CommunityDetectionResult {
    communities: CommunityNode[];
    memberships: CommunityMembership[];
    stats: {
        totalCommunities: number;
        modularity: number;
        nodesProcessed: number;
        engine?: CommunityEngine;
        engineRequested?: CommunityDetectionEngine;
        fallbackReason?: string;
    };
}
export declare const COMMUNITY_COLORS: string[];
export declare const getCommunityColor: (communityIndex: number) => string;
/**
 * Detect communities in the knowledge graph using Leiden algorithm
 *
 * This runs AFTER all relationships (CALLS, IMPORTS, etc.) have been built.
 * It uses primarily CALLS edges to cluster code that works together.
 */
export declare const processCommunities: (knowledgeGraph: KnowledgeGraph, onProgress?: (message: string, progress: number) => void, options?: CommunityDetectionOptions) => Promise<CommunityDetectionResult>;
/**
 * Build a community projection containing only symbol nodes and clustering edges.
 * For large graphs (>10K symbols), filter out low-confidence fuzzy-global edges
 * and degree-1 nodes that add noise and massively increase Leiden runtime.
 */
export declare const buildCommunityProjection: (knowledgeGraph: KnowledgeGraph) => CommunityProjection;
export declare const buildCommunityCsr: (projection: CommunityProjection) => CommunityCsr;
export declare const buildGraphologyGraph: (projection: CommunityProjection) => GraphInstance;
/**
 * Runs Leiden in a worker so a native crash cannot take the analyze process
 * with it. Written against @ladybugmem/icebug's published surface (lib/index.js
 * + index.d.ts): `GraphR(n, directed, outIndices, outIndptr)` pins the CSR
 * buffers zero-copy, and `Leiden(graph, iterations, randomize, gamma)` — note
 * `randomize` precedes `gamma` — returns `{membership, count}` from
 * `getPartition()`.
 *
 * The thread/seed controls are required, not optional: community IDs feed
 * generated context, so a build without them would give non-reproducible
 * output. They exist at icebug-nodejs HEAD but are missing from the published
 * 12.8.0 tarball, so today this guard is what trips and sends us back to
 * Graphology.
 */
export declare const buildIcebugWorkerSource: (moduleSpecifier: string) => string;
export {};
