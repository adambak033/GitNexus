/**
 * Phase: orm
 *
 * Processes ORM queries (Prisma + Supabase) and creates QUERIES edges.
 *
 * @deps    parse
 * @reads   allORMQueries (from parse)
 * @writes  graph (CodeElement nodes, QUERIES edges)
 */
import type { PipelinePhase } from './types.js';
export interface ORMOutput {
    edgesCreated: number;
    modelCount: number;
}
export declare const ormPhase: PipelinePhase<ORMOutput>;
