import { generateId } from '../../../../lib/utils.js';
export const SPRING_CONFIG_DESCRIPTION = 'Spring configuration property';
function closestNode(candidates, filePath, name, line) {
    return candidates
        .filter((node) => node.properties.filePath === filePath && node.properties.name === name)
        .sort((left, right) => Math.abs(Number(left.properties.startLine ?? 0) - line) -
        Math.abs(Number(right.properties.startLine ?? 0) - line))[0];
}
function markUnresolved(node, key) {
    const marker = `Spring config unresolved: ${key}`;
    const existing = typeof node.properties.description === 'string' ? node.properties.description : '';
    if (existing.includes(marker))
        return;
    node.properties.description = existing.length > 0 ? `${existing}; ${marker}` : marker;
}
function relaxedName(value) {
    return value.toLowerCase().replace(/[-_.]/g, '');
}
function isSpringConfigNode(node) {
    return (node.label === 'Property' &&
        typeof node.properties.description === 'string' &&
        node.properties.description.startsWith(SPRING_CONFIG_DESCRIPTION));
}
/**
 * Attach normalized, language-provider-produced Spring consumers to config
 * keys already present in the shared graph.
 */
export function bindSpringConfigConsumers(graph, batches) {
    if (batches.length === 0)
        return;
    const configNodes = [];
    const propertyNodes = [];
    const classNodes = [];
    for (const node of graph.iterNodes()) {
        if (isSpringConfigNode(node))
            configNodes.push(node);
        else if (node.label === 'Property')
            propertyNodes.push(node);
        else if (node.label === 'Class' || node.label === 'Record')
            classNodes.push(node);
    }
    const keyNodes = new Map();
    for (const node of configNodes) {
        const key = String(node.properties.name);
        const bucket = keyNodes.get(key) ?? [];
        bucket.push(node);
        keyNodes.set(key, bucket);
    }
    const propertiesByOwner = new Map();
    for (const rel of graph.iterRelationshipsByType('HAS_PROPERTY')) {
        const property = graph.getNode(rel.targetId);
        if (property?.label !== 'Property' || isSpringConfigNode(property))
            continue;
        const members = propertiesByOwner.get(rel.sourceId) ?? [];
        members.push(property);
        propertiesByOwner.set(rel.sourceId, members);
    }
    const addBinding = (source, target, reason, confidence) => {
        const edgeId = generateId('USES', `${source.id}->${target.id}:${reason}`);
        graph.addRelationship({
            id: edgeId,
            sourceId: source.id,
            targetId: target.id,
            type: 'USES',
            confidence,
            reason,
        });
    };
    for (const { filePath, consumers } of batches) {
        for (const consumer of consumers) {
            if (consumer.kind === 'value') {
                const field = closestNode(propertyNodes, filePath, consumer.fieldName, consumer.line);
                if (field === undefined)
                    continue;
                for (const key of consumer.keys) {
                    const matches = keyNodes.get(key) ?? [];
                    if (matches.length === 0) {
                        markUnresolved(field, key);
                        continue;
                    }
                    for (const match of matches) {
                        addBinding(field, match, `spring-config:@Value ${key}`, 1);
                    }
                }
                continue;
            }
            const owner = closestNode(classNodes, filePath, consumer.className, consumer.line);
            if (owner === undefined)
                continue;
            const prefix = `${consumer.prefix}.`;
            const matches = configNodes.filter((node) => {
                const key = String(node.properties.name);
                return key === consumer.prefix || key.startsWith(prefix);
            });
            if (matches.length === 0) {
                markUnresolved(owner, consumer.prefix);
                continue;
            }
            for (const match of matches) {
                addBinding(owner, match, `spring-config:@ConfigurationProperties ${consumer.prefix}`, 0.95);
            }
            for (const field of propertiesByOwner.get(owner.id) ?? []) {
                const fieldName = relaxedName(String(field.properties.name));
                for (const match of matches) {
                    const key = String(match.properties.name);
                    const suffix = key === consumer.prefix ? '' : key.slice(prefix.length);
                    const firstSegment = suffix.split(/[.\[]/, 1)[0];
                    if (firstSegment.length === 0 || relaxedName(firstSegment) !== fieldName)
                        continue;
                    addBinding(field, match, `spring-config:@ConfigurationProperties field ${consumer.prefix}`, 0.95);
                }
            }
        }
    }
}
