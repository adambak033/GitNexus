import type { GraphNode, GraphRelationship } from '../../../../_shared/index.js';
export declare const SPRING_AUTO_CONFIGURATION_IMPORT_REASON = "spring-auto-configuration-import";
export declare const SPRING_AUTO_CONFIGURATION_FACTORY_REASON = "spring-auto-configuration-factory";
export declare const SPRING_AUTO_CONFIGURATION_REASONS: readonly ["spring-auto-configuration-import", "spring-auto-configuration-factory"];
export declare const SPRING_AUTO_CONFIGURATION_SYNTHETIC_ID_PREFIX = "Class:spring-auto-configuration:";
export declare const SPRING_AUTO_CONFIGURATION_SYNTHETIC_DESCRIPTION = "Spring Boot auto-configuration declared by metadata; implementation source unavailable";
export declare function isSpringAutoConfigurationDeclaration(relationship: Pick<GraphRelationship, 'type' | 'reason'>): boolean;
export declare function isSpringAutoConfigurationSyntheticClass(node: Pick<GraphNode, 'id' | 'label'>): boolean;
