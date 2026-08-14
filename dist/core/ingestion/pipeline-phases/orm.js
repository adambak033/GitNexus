/**
 * Phase: orm
 *
 * Processes ORM queries (Prisma + Supabase) and creates QUERIES edges.
 *
 * @deps    parse
 * @reads   allORMQueries (from parse)
 * @writes  graph (CodeElement nodes, QUERIES edges)
 */
import { getPhaseOutput } from './types.js';
import { generateId } from '../../../lib/utils.js';
import { isDev } from '../utils/env.js';
import { logger } from '../../logger.js';
export const ormPhase = {
    name: 'orm',
    deps: ['parse'],
    async execute(ctx, deps) {
        const { allORMQueries } = getPhaseOutput(deps, 'parse');
        if (allORMQueries.length === 0) {
            return { edgesCreated: 0, modelCount: 0 };
        }
        return processORMQueries(ctx.graph, allORMQueries);
    },
};
function processORMQueries(graph, queries) {
    const modelNodes = new Map();
    const seenEdges = new Set();
    let edgesCreated = 0;
    for (const q of queries) {
        const modelKey = `${q.orm}:${q.model}`;
        let modelNodeId = modelNodes.get(modelKey);
        if (!modelNodeId) {
            const candidateIds = [
                generateId('Class', `${q.model}`),
                generateId('Interface', `${q.model}`),
                generateId('CodeElement', `${q.model}`),
            ];
            const existing = candidateIds.find((id) => graph.getNode(id));
            if (existing) {
                modelNodeId = existing;
            }
            else {
                modelNodeId = generateId('CodeElement', `${q.orm}:${q.model}`);
                graph.addNode({
                    id: modelNodeId,
                    label: 'CodeElement',
                    properties: {
                        name: q.model,
                        filePath: '',
                        description: `${q.orm} model/table: ${q.model}`,
                    },
                });
            }
            modelNodes.set(modelKey, modelNodeId);
        }
        const fileId = generateId('File', q.filePath);
        const edgeKey = `${fileId}->${modelNodeId}:${q.method}`;
        if (seenEdges.has(edgeKey))
            continue;
        seenEdges.add(edgeKey);
        graph.addRelationship({
            id: generateId('QUERIES', edgeKey),
            sourceId: fileId,
            targetId: modelNodeId,
            type: 'QUERIES',
            confidence: 0.9,
            reason: `${q.orm}-${q.method}`,
        });
        edgesCreated++;
    }
    if (isDev) {
        logger.info(`ORM dataflow: ${edgesCreated} QUERIES edges, ${modelNodes.size} models (${queries.length} total calls)`);
    }
    return { edgesCreated, modelCount: modelNodes.size };
}
