/**
 * Graph Queries for Wiki Generation
 *
 * Encapsulated Cypher queries against the GitNexus knowledge graph.
 * Uses the MCP-style pooled lbug-adapter for connection management.
 */
import { initLbug, executeQuery, executeParameterized, closeLbug, touchRepo, pinRepo, } from '../lbug/pool-adapter.js';
/**
 * Rows kept by each call-edge query. Owned by prompts.ts, where the reason for
 * a limit lives: every one of these lists reaches the LLM through
 * `formatCallEdges`, which slices to the same value. Fetching rows that slice
 * would discard is waste, so the cut happens here too — but as the same number,
 * not a second one, because a second one could only ever drift from it.
 */
import { CALL_EDGE_LIMIT } from './prompts.js';
const REPO_ID = '__wiki__';
/**
 * Touch the wiki DB connection to prevent idle timeout during long LLM calls.
 */
export function touchWikiDb() {
    touchRepo(REPO_ID);
}
/**
 * Keep the wiki DB resident for a full generation run. Wiki generation can spend
 * minutes inside LLM calls, and the pooled DB must survive both idle cleanup and
 * unrelated LRU pressure until the run reaches its final graph queries.
 */
export function pinWikiDb() {
    return pinRepo(REPO_ID);
}
function toCallEdge(row) {
    return {
        fromFile: row.fromFile,
        fromName: row.fromName,
        toFile: row.toFile,
        toName: row.toName,
    };
}
// The defaults below use `??`, not `||`: only an absent property falls back, so
// a process genuinely labelled '' or a step numbered 0 keeps its own value.
function toProcessHeader(row) {
    const id = row.id;
    return {
        id,
        label: row.label ?? id,
        type: row.type ?? 'unknown',
        stepCount: row.stepCount ?? 0,
    };
}
function toProcessStep(row) {
    return {
        step: row.step ?? 0,
        name: row.name,
        filePath: row.filePath,
        type: row.type,
    };
}
/**
 * Attach each header's full step trace, in one query for the whole set.
 *
 * One query per process cost 105ms for 20 processes against this repo's index;
 * grouping them on `p.id IN $ids` costs 13ms. `stepsById` below does the
 * grouping, so the rows need not arrive grouped — only in step order.
 *
 * `ORDER BY step`, and deliberately not `ORDER BY pid, step`: leading the sort
 * with the same property the `IN` list matches on makes the engine stop after
 * that key, and the trace comes back in insertion order (2,7,1,3,4,5,6 for
 * `proc_1_incrementalupdate` on this repo's index). The identical query with
 * `p.id = '…'` sorts fine, as does this one — a global sort by `step` keeps
 * each process's own rows ascending, which is all the grouping needs.
 *
 * `labels(s)`, not `labels(s)[0]`: the engine returns a node's label as a
 * scalar string, and subscripting a string is 1-based over its characters, so
 * `[0]` was always '' and `[1]` would have been 'F'. Verified against this
 * repo's index — `labels(s)` yields 'Function'.
 */
async function withSteps(headers) {
    if (headers.length === 0)
        return [];
    const stepRows = await executeParameterized(REPO_ID, `
      MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
      WHERE p.id IN $ids
      RETURN p.id AS pid, s.name AS name, s.filePath AS filePath,
             labels(s) AS type, r.step AS step
      ORDER BY step
    `, { ids: headers.map((header) => header.id) });
    const stepsById = new Map();
    for (const row of stepRows) {
        const pid = String(row.pid);
        let steps = stepsById.get(pid);
        if (!steps) {
            steps = [];
            stepsById.set(pid, steps);
        }
        steps.push(toProcessStep(row));
    }
    return headers.map((header) => ({ ...header, steps: stepsById.get(header.id) ?? [] }));
}
/**
 * Initialize the LadybugDB connection for wiki generation.
 */
export async function initWikiDb(lbugPath) {
    await initLbug(REPO_ID, lbugPath);
}
/**
 * Close the LadybugDB connection.
 */
export async function closeWikiDb() {
    await closeLbug(REPO_ID);
}
/**
 * Get all source files with their exported symbol names and types.
 * Includes top-level exports (File→DEFINES→n) and exported class members
 * (File→DEFINES→Class→HAS_METHOD/HAS_PROPERTY→n) since class members no
 * longer have a direct File→DEFINES edge.
 */
export async function getFilesWithExports() {
    // `labels(n)`, not `labels(n)[0]` — see withSteps. `prompts.ts` renders this
    // type as `name (type)`, so the subscript printed every symbol as `name ()`.
    const rows = await executeQuery(REPO_ID, `
    MATCH (f:File)-[:CodeRelation {type: 'DEFINES'}]->(n)
    WHERE n.isExported = true
    RETURN f.filePath AS filePath, n.name AS name, labels(n) AS type
    UNION
    MATCH (f:File)-[:CodeRelation {type: 'DEFINES'}]->(c)
          -[mr:CodeRelation]->(n)
    WHERE mr.type IN ['HAS_METHOD', 'HAS_PROPERTY'] AND n.isExported = true
    RETURN f.filePath AS filePath, n.name AS name, labels(n) AS type
    ORDER BY filePath
  `);
    const fileMap = new Map();
    for (const row of rows) {
        const filePath = row.filePath;
        let entry = fileMap.get(filePath);
        if (!entry) {
            entry = { filePath, symbols: [] };
            fileMap.set(filePath, entry);
        }
        entry.symbols.push({ name: row.name, type: row.type });
    }
    return Array.from(fileMap.values());
}
/**
 * Get all files tracked in the graph (including those with no exports).
 */
export async function getAllFiles() {
    const rows = await executeQuery(REPO_ID, `
    MATCH (f:File)
    RETURN f.filePath AS filePath
    ORDER BY f.filePath
  `);
    return rows.map((row) => row.filePath);
}
/**
 * Get inter-file call edges (calls between different files).
 */
export async function getInterFileCallEdges() {
    const rows = await executeQuery(REPO_ID, `
    MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b)
    WHERE a.filePath <> b.filePath
    RETURN DISTINCT a.filePath AS fromFile, a.name AS fromName,
           b.filePath AS toFile, b.name AS toName
  `);
    return rows.map(toCallEdge);
}
/**
 * Get call edges between files within a specific set (intra-module).
 */
export async function getIntraModuleCallEdges(filePaths) {
    if (filePaths.length === 0)
        return [];
    // The file list is BOUND, not spliced into the query text. A module can hold
    // every file under a parent, so an `IN [...]` literal would grow the query
    // with the repo — the shape that crashed the engine in #2915 (see
    // `coalesceHunks` in src/storage/git.ts). As a parameter the text is constant
    // at any list length, and measured ~3x faster than the equivalent literal, so
    // both arms of the predicate can stay in Cypher where the engine can use them.
    // Ordered and cut in Cypher, like getInterModuleCallEdges below and for the
    // same two reasons. Determinism: the original had no ORDER BY, so the engine's
    // arbitrary order decided which 30 `formatCallEdges` (prompts.ts) kept, and
    // the cut landed on a different subset per machine (#2787). Volume: a root
    // parent page passes every file under it, i.e. the whole repo — over 2298
    // paths this query returned 18299 rows in 1064ms to use 30 of them, against
    // 30 rows in 97ms with the LIMIT below, same leading rows.
    //
    // The engine orders by UTF-8 bytes where the JS sort this replaces compared
    // UTF-16 code units — identical for ASCII identifiers, divergent only above
    // the BMP, and the sibling already relies on the engine, so the two agree.
    const rows = await executeParameterized(REPO_ID, `
    MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b)
    WHERE a.filePath IN $paths AND b.filePath IN $paths
    RETURN DISTINCT a.filePath AS fromFile, a.name AS fromName,
           b.filePath AS toFile, b.name AS toName
    ORDER BY fromName, toName, fromFile, toFile
    LIMIT ${CALL_EDGE_LIMIT}
  `, { paths: filePaths });
    return rows.map(toCallEdge);
}
/**
 * Get call edges crossing module boundaries (external calls from/to module files).
 */
export async function getInterModuleCallEdges(filePaths) {
    if (filePaths.length === 0)
        return { outgoing: [], incoming: [] };
    // Bound list, as in getIntraModuleCallEdges — which also keeps the `NOT ...
    // IN` arm honest: `NOT null IN [...]` is null, so a callee with no filePath
    // is dropped by the engine, where a JS membership test would admit it.
    //
    // The sort leads with the symbol names, not the file paths. Ordering by
    // `fromFile` first makes the LIMIT a single-file prefix — on this repo's own
    // index the 30 outgoing edges of `core/wiki` all came from 1 of its 7 files,
    // so the module page described one file's external surface as the module's.
    // The four columns are the whole DISTINCT tuple, so any permutation is a
    // total order and equally deterministic (#2787); leading with the names just
    // spreads the window across files (1 → 7 of 7 here).
    const edgeQuery = (membership) => `
    MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b)
    WHERE ${membership}
    RETURN DISTINCT a.filePath AS fromFile, a.name AS fromName,
           b.filePath AS toFile, b.name AS toName
    ORDER BY fromName, toName, fromFile, toFile
    LIMIT ${CALL_EDGE_LIMIT}
  `;
    const [outRows, inRows] = await Promise.all([
        executeParameterized(REPO_ID, edgeQuery('a.filePath IN $paths AND NOT b.filePath IN $paths'), {
            paths: filePaths,
        }),
        executeParameterized(REPO_ID, edgeQuery('NOT a.filePath IN $paths AND b.filePath IN $paths'), {
            paths: filePaths,
        }),
    ]);
    return { outgoing: outRows.map(toCallEdge), incoming: inRows.map(toCallEdge) };
}
/**
 * Get processes (execution flows) that pass through a set of files.
 * Returns top N by step count.
 */
export async function getProcessesForFiles(filePaths, limit = 5) {
    if (filePaths.length === 0)
        return [];
    // Bound list, as in getIntraModuleCallEdges, so `LIMIT` can stay in Cypher
    // over the whole set instead of being applied per batch and re-merged.
    const procRows = await executeParameterized(REPO_ID, `
    MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
    WHERE s.filePath IN $paths
    RETURN DISTINCT p.id AS id, p.heuristicLabel AS label,
           p.processType AS type, p.stepCount AS stepCount
    ORDER BY stepCount DESC, id
    LIMIT ${limit}
  `, { paths: filePaths });
    return withSteps(procRows.map(toProcessHeader));
}
/**
 * Get all processes in the graph (for overview page).
 */
export async function getAllProcesses(limit = 20) {
    const procRows = await executeQuery(REPO_ID, `
    MATCH (p:Process)
    RETURN p.id AS id, p.heuristicLabel AS label,
           p.processType AS type, p.stepCount AS stepCount
    ORDER BY stepCount DESC, id
    LIMIT ${limit}
  `);
    return withSteps(procRows.map(toProcessHeader));
}
/**
 * Get inter-module edges for overview architecture diagram.
 * Groups call edges by source/target module.
 */
export async function getInterModuleEdgesForOverview(moduleFiles) {
    // Build file-to-module lookup
    const fileToModule = new Map();
    for (const [mod, files] of Object.entries(moduleFiles)) {
        for (const f of files) {
            fileToModule.set(f, mod);
        }
    }
    const allEdges = await getInterFileCallEdges();
    const moduleEdgeCounts = new Map();
    for (const edge of allEdges) {
        const fromMod = fileToModule.get(edge.fromFile);
        const toMod = fileToModule.get(edge.toFile);
        if (fromMod && toMod && fromMod !== toMod) {
            const key = `${fromMod}|||${toMod}`;
            moduleEdgeCounts.set(key, (moduleEdgeCounts.get(key) || 0) + 1);
        }
    }
    return Array.from(moduleEdgeCounts.entries())
        .map(([key, count]) => {
        const [from, to] = key.split('|||');
        return { from, to, count };
    })
        .sort((a, b) => b.count - a.count);
}
