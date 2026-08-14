import type { KnowledgeGraph } from '../../../graph/types.js';
export declare const SPRING_CONFIG_DESCRIPTION = "Spring configuration property";
export interface SpringValueConsumer {
    readonly kind: 'value';
    readonly fieldName: string;
    readonly line: number;
    readonly keys: readonly string[];
}
export interface SpringConfigurationPropertiesConsumer {
    readonly kind: 'configuration-properties';
    readonly className: string;
    readonly line: number;
    readonly prefix: string;
}
export type SpringConfigConsumer = SpringValueConsumer | SpringConfigurationPropertiesConsumer;
export interface SpringConfigConsumerBatch {
    readonly filePath: string;
    readonly consumers: readonly SpringConfigConsumer[];
}
/**
 * Attach normalized, language-provider-produced Spring consumers to config
 * keys already present in the shared graph.
 */
export declare function bindSpringConfigConsumers(graph: KnowledgeGraph, batches: readonly SpringConfigConsumerBatch[]): void;
