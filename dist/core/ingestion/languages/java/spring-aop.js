import { makeScopeId } from '../../../../_shared/index.js';
import { createSpringAopMetadataAttacher, hasSpringAopRelevantAnnotation, } from '../../frameworks/spring/aop.js';
import { nodeToCapture } from '../../utils/ast-helpers.js';
import { getJavaSpringAopFacts } from './capture-side-channel.js';
import { isJavaPackageSiblingVisibilityIncomplete } from './package-siblings.js';
import { javaSpringAnnotationFacts } from './spring-di.js';
function scopeId(filePath, node, kind) {
    return makeScopeId({
        filePath,
        range: nodeToCapture('@spring-aop.owner', node).range,
        kind,
    });
}
/**
 * Capture Spring AOP syntax while Java's existing class traversal already has
 * the AST node in hand. Import/FQN resolution and pointcut matching remain in
 * the shared post-resolution layer.
 */
export function captureJavaSpringAopFacts(classNode, filePath) {
    const facts = [];
    const classAnnotations = javaSpringAnnotationFacts(classNode);
    if (hasSpringAopRelevantAnnotation(classAnnotations)) {
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
        if (!hasSpringAopRelevantAnnotation(annotations))
            continue;
        facts.push({
            ownerScopeId: scopeId(filePath, member, 'Function'),
            ownerKind: 'callable',
            annotations,
        });
    }
    return facts;
}
export const attachJavaSpringAopMetadata = createSpringAopMetadataAttacher({
    getFacts: getJavaSpringAopFacts,
    isPackageVisibilityIncomplete: isJavaPackageSiblingVisibilityIncomplete,
});
