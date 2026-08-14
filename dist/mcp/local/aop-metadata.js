import { executeParameterized } from '../../core/lbug/pool-adapter.js';
import { decodeSpringAopReason, } from '../../core/ingestion/frameworks/spring/aop.js';
const SUPPORTED_SYMBOL_TYPES = new Set(['Class', 'Interface', 'Method', 'CodeElement']);
const QUERY_RESULT_LIMIT = 1_000;
const QUERY_FETCH_LIMIT = QUERY_RESULT_LIMIT + 1;
function readRowValue(row, name, index) {
    if (typeof row === 'object' && row !== null && name in row) {
        return row[name];
    }
    return Array.isArray(row) ? row[index] : undefined;
}
function readRequiredString(row, name, index) {
    const value = readRowValue(row, name, index);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function readOptionalString(row, name, index) {
    const value = readRowValue(row, name, index);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function normalizeRelationshipRow(row) {
    const sourceId = readRequiredString(row, 'sourceId', 0);
    const targetId = readRequiredString(row, 'targetId', 3);
    if (sourceId === undefined || targetId === undefined)
        return undefined;
    const sourceName = readOptionalString(row, 'sourceName', 1);
    const sourceFilePath = readOptionalString(row, 'sourceFilePath', 2);
    const targetName = readOptionalString(row, 'targetName', 4);
    const targetFilePath = readOptionalString(row, 'targetFilePath', 5);
    return {
        sourceId,
        ...optionalField('sourceName', sourceName),
        ...optionalField('sourceFilePath', sourceFilePath),
        targetId,
        ...optionalField('targetName', targetName),
        ...optionalField('targetFilePath', targetFilePath),
        reason: readRowValue(row, 'reason', 6),
    };
}
function optionalField(key, value) {
    return value === undefined ? {} : { [key]: value };
}
function stableDedupe(values, keyOf) {
    const unique = new Map();
    for (const value of values)
        unique.set(keyOf(value), value);
    return [...unique.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, value]) => value);
}
const RELATIONSHIP_PROJECTION = `
  RETURN source.id AS sourceId, source.name AS sourceName, source.filePath AS sourceFilePath,
         target.id AS targetId, target.name AS targetName, target.filePath AS targetFilePath,
         r.reason AS reason, r.step AS step
`;
const DETERMINISTIC_RELATIONSHIP_ORDER = 'ORDER BY sourceId, targetId, reason, step';
/**
 * Read additive Spring proxy/advice metadata for context and impact results.
 *
 * The helper intentionally trusts only versioned reasons accepted by the
 * shared decoder. Other DECLARES edges (for example Spring Bean factories)
 * and malformed/forward-version evidence are ignored. Query failures are
 * fail-soft because older or partially upgraded indexes must remain readable.
 */
export async function querySpringAopMetadata(lbugPath, symbolId, symbolType) {
    if (!SUPPORTED_SYMBOL_TYPES.has(symbolType))
        return undefined;
    try {
        const [outgoingAdviceRows, incomingAdviceRows, outgoingPointcutRows, incomingPointcutRows] = await Promise.all([
            executeParameterized(lbugPath, `MATCH (source {id: $symbolId})-[r:CodeRelation]->(target)
           WHERE r.type = 'ADVISED_BY'
             AND r.reason STARTS WITH 'spring-aop:v1:'
           ${RELATIONSHIP_PROJECTION}
           ${DETERMINISTIC_RELATIONSHIP_ORDER}
           LIMIT 1001`, { symbolId }),
            executeParameterized(lbugPath, `MATCH (source)-[r:CodeRelation]->(target {id: $symbolId})
           WHERE r.type = 'ADVISED_BY'
             AND r.reason STARTS WITH 'spring-aop:v1:'
           ${RELATIONSHIP_PROJECTION}
           ${DETERMINISTIC_RELATIONSHIP_ORDER}
           LIMIT 1001`, { symbolId }),
            executeParameterized(lbugPath, `MATCH (source {id: $symbolId})-[r:CodeRelation]->(target:CodeElement)
           WHERE r.type = 'DECLARES'
             AND r.reason STARTS WITH 'spring-aop:v1:'
           ${RELATIONSHIP_PROJECTION}
           ${DETERMINISTIC_RELATIONSHIP_ORDER}
           LIMIT 1001`, { symbolId }),
            executeParameterized(lbugPath, `MATCH (source)-[r:CodeRelation]->(target:CodeElement {id: $symbolId})
           WHERE r.type = 'DECLARES'
             AND r.reason STARTS WITH 'spring-aop:v1:'
           ${RELATIONSHIP_PROJECTION}
           ${DETERMINISTIC_RELATIONSHIP_ORDER}
           LIMIT 1001`, { symbolId }),
        ]);
        const behaviors = [];
        const advices = [];
        const resolvedPointcuts = [];
        const unresolvedPointcuts = [];
        const aspects = [];
        const truncated = [
            outgoingAdviceRows,
            incomingAdviceRows,
            outgoingPointcutRows,
            incomingPointcutRows,
        ].some((rows) => rows.length >= QUERY_FETCH_LIMIT);
        let queriedSymbolIsAdvisedSource = false;
        for (const [rows, isOutgoing] of [
            [outgoingAdviceRows, true],
            [incomingAdviceRows, false],
        ]) {
            for (const rawRow of rows.slice(0, QUERY_RESULT_LIMIT)) {
                const row = normalizeRelationshipRow(rawRow);
                if (row === undefined)
                    continue;
                const reason = decodeSpringAopReason(row.reason);
                if (reason?.kind === 'behavior') {
                    if (isOutgoing)
                        queriedSymbolIsAdvisedSource = true;
                    behaviors.push({
                        annotation: reason.annotation,
                        behavior: reason.behavior,
                        declaredOn: reason.declaredOn,
                        activation: reason.activation,
                        evidenceId: row.targetId,
                    });
                }
                else if (reason?.kind === 'advice') {
                    if (isOutgoing)
                        queriedSymbolIsAdvisedSource = true;
                    advices.push({
                        annotation: reason.annotation,
                        advice: reason.advice,
                        pointcut: reason.pointcut,
                        match: reason.match,
                        activation: reason.activation,
                        adviceId: row.targetId,
                        ...optionalField('adviceName', row.targetName),
                        ...optionalField('adviceFilePath', row.targetFilePath),
                        advisedId: row.sourceId,
                        ...optionalField('advisedName', row.sourceName),
                        ...optionalField('advisedFilePath', row.sourceFilePath),
                    });
                }
            }
        }
        for (const rows of [outgoingPointcutRows, incomingPointcutRows]) {
            for (const rawRow of rows.slice(0, QUERY_RESULT_LIMIT)) {
                const row = normalizeRelationshipRow(rawRow);
                if (row === undefined)
                    continue;
                const reason = decodeSpringAopReason(row.reason);
                if (reason?.kind === 'aspect') {
                    aspects.push({
                        annotation: reason.annotation,
                        activation: reason.activation,
                        registration: reason.registration,
                        evidenceId: row.targetId,
                    });
                }
                else if (reason?.kind === 'pointcut' &&
                    reason.match === 'static' &&
                    reason.resolution === 'resolved' &&
                    typeof reason.pointcut === 'string') {
                    resolvedPointcuts.push({
                        annotation: reason.annotation,
                        pointcut: reason.pointcut,
                        match: reason.match,
                        resolution: reason.resolution,
                        adviceId: row.sourceId,
                        ...optionalField('adviceName', row.sourceName),
                        ...optionalField('adviceFilePath', row.sourceFilePath),
                        evidenceId: row.targetId,
                    });
                }
                else if (reason?.kind === 'pointcut' && reason.match === 'unresolved') {
                    unresolvedPointcuts.push({
                        annotation: reason.annotation,
                        pointcut: reason.pointcut,
                        adviceId: row.sourceId,
                        ...optionalField('adviceName', row.sourceName),
                        ...optionalField('adviceFilePath', row.sourceFilePath),
                        evidenceId: row.targetId,
                    });
                }
            }
        }
        const dedupedAspects = stableDedupe(aspects, (aspect) => JSON.stringify([aspect.annotation, aspect.evidenceId]));
        const dedupedBehaviors = stableDedupe(behaviors, (behavior) => JSON.stringify([
            behavior.behavior,
            behavior.annotation,
            behavior.declaredOn,
            behavior.evidenceId,
        ]));
        const dedupedAdvices = stableDedupe(advices, (advice) => JSON.stringify([advice.advisedId, advice.adviceId, advice.advice, advice.pointcut]));
        const dedupedPointcuts = stableDedupe(unresolvedPointcuts, (pointcut) => JSON.stringify([
            pointcut.adviceId,
            pointcut.evidenceId,
            pointcut.annotation,
            pointcut.pointcut,
        ]));
        const dedupedResolvedPointcuts = stableDedupe(resolvedPointcuts, (pointcut) => JSON.stringify([
            pointcut.adviceId,
            pointcut.evidenceId,
            pointcut.annotation,
            pointcut.pointcut,
        ]));
        if (dedupedAspects.length === 0 &&
            dedupedBehaviors.length === 0 &&
            dedupedAdvices.length === 0 &&
            dedupedResolvedPointcuts.length === 0 &&
            dedupedPointcuts.length === 0) {
            return undefined;
        }
        return {
            framework: 'spring',
            ...(queriedSymbolIsAdvisedSource ? { proxied: 'possible' } : {}),
            ...(truncated ? { truncated: true } : {}),
            ...(dedupedAspects[0] === undefined ? {} : { aspect: dedupedAspects[0] }),
            behaviors: dedupedBehaviors,
            advices: dedupedAdvices,
            resolvedPointcuts: dedupedResolvedPointcuts,
            unresolvedPointcuts: dedupedPointcuts,
        };
    }
    catch {
        return undefined;
    }
}
