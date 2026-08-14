import { makeScopeId } from '../../../../_shared/index.js';
import { createSpringAopMetadataAttacher, } from '../../frameworks/spring/aop.js';
import { nodeToCapture } from '../../utils/ast-helpers.js';
import { getKotlinSpringAopFacts } from './capture-side-channel.js';
import { isKotlinPackageSiblingVisibilityIncomplete } from './package-siblings.js';
import { kotlinSpringAnnotationFacts } from './spring-di.js';
function scopeId(filePath, node, kind) {
    return makeScopeId({
        filePath,
        range: nodeToCapture('@spring-aop.owner', node).range,
        kind,
    });
}
function ownerRange(node) {
    return nodeToCapture('@spring-aop.owner', node).range;
}
/**
 * Capture Spring AOP syntax from the class node already surfaced by Kotlin's
 * scope query. The shared layer resolves annotations and rejects non-default
 * use-site targets after imports and package visibility have finalized.
 */
export function captureKotlinSpringAopFacts(classNode, filePath) {
    const facts = [];
    const classAnnotations = kotlinSpringAnnotationFacts(classNode);
    const singletonInstance = classNode.type === 'object_declaration' || classNode.type === 'companion_object';
    // Kotlin import aliases can give a Spring annotation any local simple name.
    // Capture annotated owners conservatively, then let the post-import shared
    // resolver keep only recognized Spring AOP annotations. Objects also retain
    // an empty owner fact so the shared phase can distinguish their singleton
    // instance members from true static methods without naming Kotlin.
    if (classAnnotations.length > 0 || singletonInstance) {
        facts.push({
            ownerScopeId: scopeId(filePath, classNode, 'Class'),
            ownerKind: 'class',
            ownerFilePath: filePath,
            ownerRange: ownerRange(classNode),
            ...(singletonInstance ? { singletonInstance: true } : {}),
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
        if (annotations.length === 0)
            continue;
        facts.push({
            ownerScopeId: scopeId(filePath, member, 'Function'),
            ownerKind: 'callable',
            ownerFilePath: filePath,
            ownerRange: ownerRange(member),
            ...(singletonInstance ? { singletonInstance: true } : {}),
            annotations,
        });
    }
    return facts;
}
export const attachKotlinSpringAopMetadata = createSpringAopMetadataAttacher({
    getFacts: getKotlinSpringAopFacts,
    isPackageVisibilityIncomplete: isKotlinPackageSiblingVisibilityIncomplete,
});
