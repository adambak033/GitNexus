export const SPRING_BEAN_STEREOTYPES = new Map([
    ['org.springframework.stereotype.Component', { role: 'component' }],
    ['org.springframework.stereotype.Service', { role: 'service' }],
    ['org.springframework.stereotype.Repository', { role: 'repository' }],
    ['org.springframework.stereotype.Controller', { role: 'controller' }],
    ['org.springframework.web.bind.annotation.RestController', { role: 'rest-controller' }],
    ['org.springframework.context.annotation.Configuration', { role: 'configuration' }],
    ['org.springframework.boot.autoconfigure.AutoConfiguration', { role: 'auto-configuration' }],
]);
export function deriveSpringBeanMetadata(frameworkAnnotations) {
    const recognized = [
        ...new Set(frameworkAnnotations.filter((annotation) => SPRING_BEAN_STEREOTYPES.has(annotation))),
    ];
    if (recognized.length !== 1)
        return undefined;
    const annotation = recognized[0];
    const stereotype = SPRING_BEAN_STEREOTYPES.get(annotation);
    if (!stereotype)
        return undefined;
    return { framework: 'spring', role: stereotype.role, annotation };
}
const SPRING_BEAN_SOURCE_EXTENSIONS = ['.java', '.kt', '.kts'];
/** Whether a source change can alter Spring Bean candidate metadata. */
export function isSpringBeanCandidateSourceFile(filePath) {
    const normalized = filePath.toLowerCase();
    return SPRING_BEAN_SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}
