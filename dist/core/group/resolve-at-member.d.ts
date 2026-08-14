/**
 * Map MCP/CLI `@groupName` or `@groupName/memberPath` to a concrete member path in group.yaml.
 */
export declare function resolveAtGroupMemberRepoPath(groupName: string, explicitMemberPath: string | undefined): Promise<{
    ok: true;
    repoPath: string;
} | {
    ok: false;
    error: string;
}>;
