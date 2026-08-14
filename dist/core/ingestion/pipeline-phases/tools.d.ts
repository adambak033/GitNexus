/**
 * Phase: tools
 *
 * Detects MCP/RPC tool definitions and creates Tool graph nodes.
 *
 * @deps    parse
 * @reads   allToolDefs (from parse), allPaths
 * @writes  graph (Tool nodes, HANDLES_TOOL edges)
 * @output  toolDefs array
 */
import type { PipelinePhase } from './types.js';
export interface ToolDef {
    name: string;
    filePath: string;
    description: string;
    handlerNodeId?: string;
}
export interface ToolsOutput {
    toolDefs: ToolDef[];
}
export declare const toolsPhase: PipelinePhase<ToolsOutput>;
