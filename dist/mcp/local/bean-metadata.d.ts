import { type SpringBeanMetadata } from '../../core/ingestion/frameworks/spring/bean-catalog.js';
import { type SpringBeanFactoryMetadata } from '../../core/ingestion/frameworks/spring/bean-factories.js';
export declare function queryClassBeanMetadata(lbugPath: string, symbolId: string, symbolType: string): Promise<SpringBeanMetadata | SpringBeanFactoryMetadata | undefined>;
