/**
 * Phase: communities
 *
 * Detects code communities via Leiden algorithm and creates
 * Community nodes + MEMBER_OF edges.
 *
 * @deps    mro, pruneLocalSymbols
 * @reads   graph (all nodes and relationships)
 * @writes  graph (Community nodes, MEMBER_OF edges)
 */
import type { PipelinePhase } from './types.js';
import { type CommunityDetectionResult } from '../community-processor.js';
export interface CommunitiesOutput {
    communityResult: CommunityDetectionResult;
}
export declare const communitiesPhase: PipelinePhase<CommunitiesOutput>;
