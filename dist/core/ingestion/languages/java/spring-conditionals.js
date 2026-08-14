import { makeScopeId } from '../../../../_shared/index.js';
import { createSpringConditionalMetadataAttacher, hasSpringConditionalRelevantAnnotation, } from '../../frameworks/spring/conditionals.js';
import { nodeToCapture } from '../../utils/ast-helpers.js';
import { getJavaSpringConditionalFacts } from './capture-side-channel.js';
import { isJavaPackageSiblingVisibilityIncomplete } from './package-siblings.js';
import { javaSpringAnnotationFacts } from './spring-di.js';
function scopeId(filePath, node, kind) {
    return makeScopeId({
        filePath,
        range: nodeToCapture('@spring-condition.owner', node).range,
        kind,
    });
}
/**
 * Capture Spring condition syntax while Java's existing class traversal already
 * has the AST node in hand. Framework/FQN semantics are resolved later.
 */
export function captureJavaSpringConditionalFacts(classNode, filePath) {
    const facts = [];
    const classAnnotations = javaSpringAnnotationFacts(classNode);
    if (hasSpringConditionalRelevantAnnotation(classAnnotations)) {
        facts.push({
            ownerScopeId: scopeId(filePath, classNode, 'Class'),
            ownerKind: 'class',
            annotations: classAnnotations,
        });
    }
    const body = classNode.childForFieldName('body');
    if (body === null)
        return facts;
    for (const member of body.namedChildren) {
        if (member.type !== 'method_declaration')
            continue;
        const annotations = javaSpringAnnotationFacts(member);
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
export const attachJavaSpringConditionalMetadata = createSpringConditionalMetadataAttacher({
    getFacts: getJavaSpringConditionalFacts,
    isPackageVisibilityIncomplete: isJavaPackageSiblingVisibilityIncomplete,
});
