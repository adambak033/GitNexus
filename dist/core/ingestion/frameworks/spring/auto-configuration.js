export const SPRING_AUTO_CONFIGURATION_IMPORT_REASON = 'spring-auto-configuration-import';
export const SPRING_AUTO_CONFIGURATION_FACTORY_REASON = 'spring-auto-configuration-factory';
export const SPRING_AUTO_CONFIGURATION_REASONS = [
    SPRING_AUTO_CONFIGURATION_IMPORT_REASON,
    SPRING_AUTO_CONFIGURATION_FACTORY_REASON,
];
export const SPRING_AUTO_CONFIGURATION_SYNTHETIC_ID_PREFIX = 'Class:spring-auto-configuration:';
export const SPRING_AUTO_CONFIGURATION_SYNTHETIC_DESCRIPTION = 'Spring Boot auto-configuration declared by metadata; implementation source unavailable';
export function isSpringAutoConfigurationDeclaration(relationship) {
    return (relationship.type === 'DECLARES' &&
        (relationship.reason === SPRING_AUTO_CONFIGURATION_IMPORT_REASON ||
            relationship.reason === SPRING_AUTO_CONFIGURATION_FACTORY_REASON));
}
export function isSpringAutoConfigurationSyntheticClass(node) {
    return (node.label === 'Class' && node.id.startsWith(SPRING_AUTO_CONFIGURATION_SYNTHETIC_ID_PREFIX));
}
