import { makeScopeId } from '../../../../_shared/index.js';
import { createSpringConditionalMetadataAttacher, hasSpringConditionalRelevantAnnotation, } from '../../frameworks/spring/conditionals.js';
import { nodeToCapture } from '../../utils/ast-helpers.js';
import { getKotlinSpringConditionalFacts } from './capture-side-channel.js';
import { isKotlinPackageSiblingVisibilityIncomplete } from './package-siblings.js';
import { kotlinSpringAnnotationFacts } from './spring-di.js';
function scopeId(filePath, node, kind) {
    return makeScopeId({
        filePath,
        range: nodeToCapture('@spring-condition.owner', node).range,
        kind,
    });
}
/**
 * Capture Kotlin condition syntax from the class node already surfaced by the
 * scope query. Kotlin syntax stays local; shared Spring semantics are attached
 * after resolution.
 */
export function captureKotlinSpringConditionalFacts(classNode, filePath) {
    const facts = [];
    const classAnnotations = kotlinSpringAnnotationFacts(classNode);
    if (hasSpringConditionalRelevantAnnotation(classAnnotations)) {
        facts.push({
            ownerScopeId: scopeId(filePath, classNode, 'Class'),
            ownerKind: 'class',
            annotations: classAnnotations,
        });
    }
    const body = classNode.namedChildren.find((child) => child.type === 'class_body');
    if (body === undefined)
        return facts;
    for (const member of body.namedChildren) {
        if (member.type !== 'function_declaration')
            continue;
        const annotations = kotlinSpringAnnotationFacts(member);
        if (!hasSpringConditionalRelevantAnnotation(annotations))
            continue;
        facts.push({
            ownerScopeId: scopeId(filePath, member, 'Function'),
            ownerKind: 'callable',
            annotations,
        });
    }
    return facts;
}
export const attachKotlinSpringConditionalMetadata = createSpringConditionalMetadataAttacher({
    getFacts: getKotlinSpringConditionalFacts,
    isPackageVisibilityIncomplete: isKotlinPackageSiblingVisibilityIncomplete,
});
