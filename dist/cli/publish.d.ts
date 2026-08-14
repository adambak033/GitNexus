/**
 * `gitnexus publish` — opt-in ping to the understand-quickly registry.
 *
 * Fires a single `repository_dispatch` event at
 * `looptech-ai/understand-quickly` so the registry knows to refresh its
 * entry for the current repo. Does NOT upload anything: per the
 * understand-quickly protocol, the registry pulls the graph from a
 * raw-GitHub URL the user controls.
 *
 *   https://github.com/looptech-ai/understand-quickly/blob/main/docs/integrations/protocol.md
 *
 * Defaults:
 *   - Without `UNDERSTAND_QUICKLY_TOKEN` in the env, this is a no-op
 *     (prints one informational line, exit 0). Same shape as the
 *     `--publish` patterns in sibling tools.
 *   - With the token, fires the dispatch and reports the response code.
 *
 * The `id` is derived from the repo's `origin` remote unless the caller
 * passes `--id <owner/repo>` explicitly. We deliberately do NOT auto-add
 * the repo to the registry — registration is one-time and uses the
 * `npx @understand-quickly/cli add` path documented in the protocol.
 */
export interface PublishOptions {
    /** Override the auto-derived `owner/repo` id. */
    id?: string;
    /** Treat the cwd as the repo root (skip git-root walk). */
    skipGit?: boolean;
}
export declare const publishCommand: (inputPath?: string, options?: PublishOptions) => Promise<void>;
