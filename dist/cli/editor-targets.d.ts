/**
 * Editor targets — the single source of truth for *where* GitNexus writes its
 * per-editor configuration and *how* its entries are identified.
 *
 * `setup` (writes these) and `uninstall` (removes them) both consume this
 * module so the two stay structurally in lock-step: add or change a target
 * here and both sides follow. This is declarative metadata only — file
 * locations, JSON key paths, hook event names, command needles, and script
 * directories, plus the shared `detectIndentation` formatting helper. The
 * format-specific read/write logic (JSONC merge, TOML upsert, OpenCode's flat
 * command array, Gemini's hook schema) deliberately stays in setup.ts /
 * uninstall.ts.
 *
 * The `setup → uninstall` round-trip integration test verifies the two
 * implementations remain behaviourally symmetrical on top of this shared
 * structure.
 */
export type EditorId = 'cursor' | 'claude' | 'antigravity' | 'opencode' | 'codebuddy' | 'qoder' | 'codex';
/** An editor whose MCP config is a JSONC document (server keyed by name). */
export interface McpJsoncTarget {
    id: EditorId;
    label: string;
    /** Absolute path to the editor's MCP config file. */
    file: string;
    /**
     * JSON path of the gitnexus server entry within that file. Typed as
     * `string[]` (all our keys are object keys) so it satisfies both setup's
     * `mergeJsoncFile(string[])` and uninstall's `removeJsoncKey(JSONPath)`
     * without either side needing a cast.
     */
    keyPath: string[];
    /**
     * Older config locations the editor still reads when `file` is absent
     * (CodeBuddy reads only the FIRST existing file in its priority chain).
     * Setup writes into the first existing candidate of [file, ...legacyFiles]
     * so it never shadows a user's servers living in a deprecated file;
     * uninstall sweeps all of them.
     */
    legacyFiles?: string[];
}
/** Codex stores MCP config as a TOML table, not JSONC. */
export interface CodexMcpTarget {
    id: 'codex';
    label: string;
    /** Absolute path to ~/.codex/config.toml. */
    configFile: string;
    /** The TOML table header (without brackets) setup writes / uninstall strips. */
    tomlSection: string;
}
export interface SkillTarget {
    id: EditorId;
    label: string;
    /** Absolute path to the editor's skills directory. */
    dir: string;
}
export interface HookTarget {
    id: EditorId;
    label: string;
    /** Absolute path to the editor's settings file (JSONC). */
    settingsFile: string;
    /** Hook event arrays that may hold a gitnexus entry. */
    events: string[];
    /** Substring identifying the gitnexus command within a hook entry. */
    needle: string;
    /** Absolute path to the bundled hook-script directory setup writes. */
    scriptDir: string;
}
export interface EditorTargets {
    /** JSONC-format MCP entries: Cursor, Claude Code, Antigravity, OpenCode, CodeBuddy, Qoder. */
    mcpJsonc: McpJsoncTarget[];
    /** Codex MCP (TOML). */
    codex: CodexMcpTarget;
    /** Skill install directories, one per editor that supports skills. */
    skills: SkillTarget[];
    /** Hook registrations + their bundled script directories. */
    hooks: HookTarget[];
}
/**
 * Resolve all editor targets for the given home directory. Defaults to
 * `os.homedir()`; call sites pass it through so tests can point HOME at a temp
 * dir. Paths are computed at call time (not module load) so a test setting
 * `process.env.HOME` before invoking sees the right locations.
 */
export declare function getEditorTargets(home?: string): EditorTargets;
/** Look up a single JSONC MCP target by editor id (throws if unknown). */
export declare function mcpTarget(id: EditorId, home?: string): McpJsoncTarget;
/** Look up a single skill target by editor id (throws if unknown). */
export declare function skillTarget(id: EditorId, home?: string): SkillTarget;
/** Look up a single hook target by editor id (throws if unknown). */
export declare function hookTarget(id: EditorId, home?: string): HookTarget;
/**
 * True when err is a Node fs error with code ENOENT (file/dir absent).
 * Shared by setup and uninstall: both must swallow ONLY absence when reading
 * editor configs — any other read/stat failure (EACCES, EIO) is surfaced so an
 * unreadable config is never treated as empty and rewritten gitnexus-only.
 */
export declare function isEnoent(err: unknown): boolean;
/**
 * Detect indentation style from file content so JSONC edits preserve the file's
 * existing formatting. Shared by setup (writes) and uninstall (removes).
 */
export declare function detectIndentation(raw: string): {
    tabSize: number;
    insertSpaces: boolean;
};
