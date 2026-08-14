import type { ContractRegistry } from './types.js';
export declare function getDefaultGitnexusDir(): string;
export declare function getGroupsBaseDir(gitnexusDir?: string): string;
export declare function validateGroupName(name: string): void;
export declare function getGroupDir(gitnexusDir: string, groupName: string): string;
export declare function writeContractRegistry(groupDir: string, registry: ContractRegistry): Promise<void>;
export declare function readContractRegistry(groupDir: string): Promise<ContractRegistry | null>;
export declare function listGroups(gitnexusDir?: string): Promise<string[]>;
export declare function createGroupDir(gitnexusDir: string, groupName: string, force?: boolean): Promise<string>;
