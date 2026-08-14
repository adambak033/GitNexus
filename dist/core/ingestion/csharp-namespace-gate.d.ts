/**
 * Pure predicates gating C# `using` suffix-fallback resolution so BCL usings
 * (e.g. `System.Threading.Tasks`) can't match a coincidentally-named local
 * file (#1881).
 *
 * Lives in the shared `ingestion/` layer — NOT under `languages/csharp/` — so
 * BOTH the registry-primary scope resolver (`languages/csharp/import-target.ts`)
 * and the legacy DAG resolver (`import-resolvers/csharp.ts`) can import it
 * without an `import-resolvers/ -> languages/` dependency inversion (#5).
 */
import type { CSharpNamespaceEvidence } from './language-config.js';
/**
 * Whether the unanchored suffix fallback may run for `targetRaw`.
 *
 * Fails OPEN when the namespace scan was truncated (large repos must not
 * silently lose legitimate edges, #1881 #11) and when no evidence was
 * threaded at all (preserves legacy permissive behavior). The truncation
 * fail-open is carved out for clearly-external roots (BCL / well-known
 * packages) that the repo does not declare, so one incomplete scan can't
 * re-open the #1881 hole repo-wide. Otherwise defers to
 * {@link importAlignsWithDeclaredNamespaces}.
 */
export declare function csharpSuffixFallbackAllowed(targetRaw: string, evidence: CSharpNamespaceEvidence | undefined): boolean;
/** True when `targetRaw` plausibly refers to a namespace declared in-repo. */
export declare function importAlignsWithDeclaredNamespaces(targetRaw: string, declaredNamespaces: ReadonlySet<string> | undefined, rootNamespaces?: ReadonlySet<string>): boolean;
