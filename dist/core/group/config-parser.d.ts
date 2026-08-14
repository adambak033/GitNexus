import type { GroupConfig } from './types.js';
export declare function parseGroupConfig(yamlContent: string): GroupConfig;
export declare class GroupNotFoundError extends Error {
    readonly groupName: string;
    constructor(groupName: string);
}
export declare function loadGroupConfig(groupDir: string): Promise<GroupConfig>;
