/**
 * Understand-Quickly registry integration helpers.
 *
 * Pure, runtime-agnostic logic for opting in to publishing a GitNexus
 * index to the [`looptech-ai/understand-quickly`](https://github.com/looptech-ai/understand-quickly)
 * registry. Lives in `gitnexus-shared` so both the Node CLI and any
 * future browser-side surface can construct identical dispatch payloads.
 *
 * Network I/O lives in the CLI command (`gitnexus/src/cli/publish.ts`)
 * to keep this module free of Node-only imports — see the comment at
 * the top of `gitnexus-shared/src/graph/types.ts`.
 *
 * The protocol contract (single dispatch event, no graph upload) is
 * documented at:
 *   https://github.com/looptech-ai/understand-quickly/blob/main/docs/integrations/protocol.md
 */
/**
 * URL of the registry repo's repository_dispatch endpoint. Hardcoded
 * because the registry is the canonical home for this integration —
 * users who want a private registry can fork and patch.
 */
export declare const UNDERSTAND_QUICKLY_DISPATCH_URL = "https://api.github.com/repos/looptech-ai/understand-quickly/dispatches";
/**
 * Event type the registry's sync workflow listens for.
 * See `looptech-ai/understand-quickly/.github/workflows/sync.yml`.
 */
export declare const UNDERSTAND_QUICKLY_EVENT_TYPE = "sync-entry";
/** Environment variable that gates the dispatch. */
export declare const UNDERSTAND_QUICKLY_TOKEN_ENV = "UNDERSTAND_QUICKLY_TOKEN";
export interface UqDispatchPayload {
    event_type: typeof UNDERSTAND_QUICKLY_EVENT_TYPE;
    client_payload: {
        /** `<owner>/<repo>` shape — must match the registered entry. */
        id: string;
    };
}
/**
 * Build the JSON body for the `repository_dispatch` ping. Pure — no
 * env reads, no network. Validates that `id` looks like `owner/repo`
 * (one slash, no whitespace, both halves non-empty) so a misconfigured
 * caller fails loudly before the round-trip.
 */
export declare function buildUqDispatchPayload(id: string): UqDispatchPayload;
/**
 * `owner/repo` validation. Conservative on purpose: GitHub's actual
 * naming rules are looser, but we want to catch local paths
 * (`/Users/...`), bare slugs (`my-repo`), and accidental whitespace.
 *
 * Matches GitHub's published slug rules:
 *   owner: starts with alnum, then alnum/hyphen only, must end with
 *          alnum (no trailing hyphen — GitHub rejects this at account
 *          creation, so a `my-org-/repo` input would otherwise pass us
 *          and 422 from GitHub). No underscore, no dot. Length cap 39.
 *   repo:  any of alnum/dot/hyphen/underscore. Length cap 100.
 */
export declare function isValidOwnerRepo(id: string): boolean;
/**
 * Strip a single trailing `.git` (case-insensitive) and any trailing
 * slashes from a URL-ish string. Bounded linear: each character is
 * visited at most twice, no backtracking.
 *
 * Replaces `s.replace(/\.git\/*$/i, '').replace(/\/+$/, '')` which
 * CodeQL's polynomial-regex check (codeql/js/polynomial-redos) flags as
 * a worst-case O(n²) on adversarial input like "////.../x".
 */
export declare function stripGitSuffix(input: string): string;
/**
 * Parse `owner/repo` out of a git remote URL. Mirrors the heuristic in
 * `gitnexus/src/storage/git.ts:parseRepoNameFromUrl` but keeps both
 * halves so we can build a registry id. Returns `null` on shapes we
 * don't recognise.
 *
 * Examples:
 *   git@github.com:looptech-ai/understand-quickly.git
 *   https://github.com/looptech-ai/understand-quickly
 *   ssh://git@github.com/looptech-ai/understand-quickly.git
 */
export declare function parseOwnerRepoFromRemote(url: string | null | undefined): string | null;
//# sourceMappingURL=understand-quickly.d.ts.map