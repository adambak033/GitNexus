/**
 * Phase: springConfig
 *
 * Adds key-only nodes for statically readable Spring
 * `application*.properties` / `application*.yml` / `application*.yaml` files.
 * Language-specific ScopeResolver hooks attach consumers later. Configuration
 * values are deliberately never copied into the graph because they may contain
 * credentials and key identity is sufficient for impact analysis.
 *
 * @deps    structure
 * @reads   Spring application configuration files
 * @writes  Property nodes and DEFINES edges
 */
import type { PipelinePhase } from './types.js';
export interface SpringConfigKey {
    readonly key: string;
    readonly filePath: string;
    readonly line: number;
    readonly profile?: string;
    readonly format: 'properties' | 'yaml';
}
interface SpringConfigFile {
    readonly filePath: string;
    readonly profile?: string;
    readonly format: SpringConfigKey['format'];
}
export interface SpringConfigOutput {
    readonly configKeys: number;
}
/** Match only Spring Boot's conventional application config file names. */
export declare function classifySpringConfigFile(filePath: string): SpringConfigFile | null;
/** Parse `.properties` keys without retaining their values. */
export declare function parseSpringProperties(content: string, filePath: string, profile?: string): SpringConfigKey[];
/** Parse and flatten YAML leaves without retaining their values. */
export declare function parseSpringYaml(content: string, filePath: string, profile?: string): SpringConfigKey[];
export declare const springConfigPhase: PipelinePhase<SpringConfigOutput>;
export {};
