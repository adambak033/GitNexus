/**
 * Phase: pruneLocalSymbols
 *
 * Drops inert function/block-local value symbols after scope resolution has
 * already used them for binding and call resolution.
 *
 * @deps    scopeResolution
 * @reads   graph (nodes and relationships)
 * @writes  graph (removes unreferenced local Const/Variable/Static nodes)
 */
import type { PipelinePhase } from './types.js';
import { type LocalSymbolPruneStats } from '../local-symbol-pruner.js';
export type PruneLocalSymbolsOutput = LocalSymbolPruneStats;
export declare const pruneLocalSymbolsPhase: PipelinePhase<PruneLocalSymbolsOutput>;
