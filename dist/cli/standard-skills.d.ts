export type StandardSkillDistribution = 'project' | 'npm' | 'claudePlugin' | 'cursor';
export interface StandardSkillCatalogEntry {
    readonly name: `gitnexus-${string}`;
    readonly agentTableTask: string;
    readonly fallbackDescription: string;
    readonly distributions: Readonly<Record<StandardSkillDistribution, boolean>>;
}
/**
 * Canonical metadata for the standard skills installed by `gitnexus analyze`.
 *
 * Keep distribution intent here so generated agent guidance and drift guards
 * cannot disagree about which copies should exist. The ordering intentionally
 * matches the generated AGENTS.md / CLAUDE.md task table.
 */
export declare const STANDARD_SKILL_CATALOG: readonly [{
    readonly name: "gitnexus-exploring";
    readonly agentTableTask: "Understand architecture / \"How does X work?\"";
    readonly fallbackDescription: "Use when the user asks how code works, wants to understand architecture, trace execution flows, or explore unfamiliar parts of the codebase. Examples: \"How does X work?\", \"What calls this function?\", \"Show me the auth flow\"";
    readonly distributions: {
        readonly project: true;
        readonly npm: true;
        readonly claudePlugin: true;
        readonly cursor: true;
    };
}, {
    readonly name: "gitnexus-impact-analysis";
    readonly agentTableTask: "Blast radius / \"What breaks if I change X?\"";
    readonly fallbackDescription: "Use when the user wants to know what will break if they change something, or needs safety analysis before editing code. Examples: \"Is it safe to change X?\", \"What depends on this?\", \"What will break?\"";
    readonly distributions: {
        readonly project: true;
        readonly npm: true;
        readonly claudePlugin: true;
        readonly cursor: true;
    };
}, {
    readonly name: "gitnexus-debugging";
    readonly agentTableTask: "Trace bugs / \"Why is X failing?\"";
    readonly fallbackDescription: "Use when the user is debugging a bug, tracing an error, or asking why something fails. Examples: \"Why is X failing?\", \"Where does this error come from?\", \"Trace this bug\"";
    readonly distributions: {
        readonly project: true;
        readonly npm: true;
        readonly claudePlugin: true;
        readonly cursor: true;
    };
}, {
    readonly name: "gitnexus-refactoring";
    readonly agentTableTask: "Rename / extract / split / refactor";
    readonly fallbackDescription: "Use when the user wants to rename, extract, split, move, or restructure code safely. Examples: \"Rename this function\", \"Extract this into a module\", \"Refactor this class\", \"Move this to a separate file\"";
    readonly distributions: {
        readonly project: true;
        readonly npm: true;
        readonly claudePlugin: true;
        readonly cursor: true;
    };
}, {
    readonly name: "gitnexus-guide";
    readonly agentTableTask: "Tools, resources, schema reference";
    readonly fallbackDescription: "Use when the user asks about GitNexus itself — available tools, how to query the knowledge graph, MCP resources, graph schema, or workflow reference. Examples: \"What GitNexus tools are available?\", \"How do I use GitNexus?\"";
    readonly distributions: {
        readonly project: true;
        readonly npm: true;
        readonly claudePlugin: true;
        readonly cursor: false;
    };
}, {
    readonly name: "gitnexus-cli";
    readonly agentTableTask: "Index, status, clean, wiki CLI commands";
    readonly fallbackDescription: "Use when the user needs to run GitNexus CLI commands like analyze/index a repo, check status, clean the index, generate a wiki, or list indexed repos. Examples: \"Index this repo\", \"Reanalyze the codebase\", \"Generate a wiki\"";
    readonly distributions: {
        readonly project: true;
        readonly npm: true;
        readonly claudePlugin: true;
        readonly cursor: false;
    };
}];
export type StandardSkillName = (typeof STANDARD_SKILL_CATALOG)[number]['name'];
