import type { StoredContract, CrossLink, MatchingConfig } from './types.js';
export interface MatchResult {
    matched: CrossLink[];
    unmatched: StoredContract[];
}
export interface WildcardMatchResult {
    matched: CrossLink[];
    remaining: StoredContract[];
}
export declare function normalizeContractId(id: string): string;
export declare function buildProviderIndex(contracts: StoredContract[], matchingConfig?: MatchingConfig): Map<string, StoredContract[]>;
export declare function runExactMatch(contracts: StoredContract[], providerIndex?: Map<string, StoredContract[]>, matchingConfig?: MatchingConfig): MatchResult;
export declare function runWildcardMatch(unmatched: StoredContract[], providerIndex: Map<string, StoredContract[]>): WildcardMatchResult;
