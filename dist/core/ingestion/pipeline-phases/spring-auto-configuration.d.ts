/**
 * Phase: springAutoConfiguration
 *
 * Discovers Spring Boot auto-configuration declarations from repository
 * metadata after source symbols have been resolved. Metadata-backed classes
 * are linked through DECLARES; when source is unavailable, a lightweight
 * synthetic Class preserves the third-party/starter contribution.
 *
 * @deps    structure, scopeResolution
 * @reads   META-INF/spring.factories and AutoConfiguration.imports
 * @writes  Class nodes and DECLARES edges
 */
import type { PipelinePhase } from './types.js';
export interface SpringAutoConfigurationEntry {
    readonly className: string;
    readonly line: number;
}
type SpringAutoConfigurationMetadataKind = 'imports' | 'spring-factories';
interface SpringAutoConfigurationMetadataFile {
    readonly filePath: string;
    readonly kind: SpringAutoConfigurationMetadataKind;
}
export interface SpringAutoConfigurationOutput {
    readonly metadataFiles: number;
    readonly autoConfigurations: number;
    readonly ambiguousAutoConfigurations: number;
}
export declare function classifySpringAutoConfigurationMetadata(filePath: string): SpringAutoConfigurationMetadataFile | null;
/** Parse Boot 2.7+/3.x one-class-per-line auto-configuration imports. */
export declare function parseSpringAutoConfigurationImports(content: string): SpringAutoConfigurationEntry[];
/** Parse the legacy Boot 1.x/2.x EnableAutoConfiguration factory entry. */
export declare function parseSpringFactoriesAutoConfigurations(content: string): SpringAutoConfigurationEntry[];
export declare const springAutoConfigurationPhase: PipelinePhase<SpringAutoConfigurationOutput>;
export {};
