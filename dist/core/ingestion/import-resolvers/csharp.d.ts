/**
 * C# namespace import resolution — internal helpers.
 *
 * Strategy lives in configs/csharp.ts.
 * This file contains shared helpers for namespace-based resolution.
 */
import type { SuffixIndex } from './utils.js';
import type { CSharpProjectConfig, CSharpNamespaceEvidence } from '../language-config.js';
/**
 * Resolve a C# using-directive import path to matching .cs files (low-level helper).
 * Tries single-file match first, then directory match for namespace imports.
 *
 * The final unanchored suffix fallback is gated on `evidence` so BCL usings
 * (e.g. `System.Threading.Tasks`) can't match a coincidentally-named local
 * file (#1881). When `evidence` is omitted the fallback stays permissive.
 *
 * Takes the file SET, not the two materialized lists it used to take: both are
 * derived here from the per-pass `getWorkspaceFileIndex` memo, which is where
 * every caller already got them. That leaves one key shape for the indexes
 * below and makes the `normalized`/`all` pairing structural rather than a
 * contract the caller has to honour. `index` stays a parameter — the parity
 * harness drives this resolver with and without one, and the no-index legs are
 * a tested dimension, not a degenerate case.
 */
export declare function resolveCSharpImportInternal(importPath: string, csharpConfigs: CSharpProjectConfig[], allFilePaths: ReadonlySet<string>, index?: SuffixIndex, evidence?: CSharpNamespaceEvidence): string[];
/**
 * Compute the directory suffix for a C# namespace import (for PackageMap).
 * Returns a suffix like "/ProjectDir/Models/" or null if no config matches.
 */
export declare function resolveCSharpNamespaceDir(importPath: string, csharpConfigs: CSharpProjectConfig[]): string | null;
