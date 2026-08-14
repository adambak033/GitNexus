/**
 * Capture-match → semantic-shape interpreters for PHP.
 *
 *   - `interpretPhpImport`       → `ParsedImport`
 *   - `interpretPhpTypeBinding`  → `ParsedTypeBinding`
 *
 * Import matches arrive pre-decomposed by `emitPhpScopeCaptures` (one
 * CaptureMatch per logical import, with synthesized `@import.kind /
 * source / name / alias` markers). Type-binding matches arrive from
 * the raw query captures — each `@type-binding.*` anchor carries
 * `@type-binding.name` + `@type-binding.type`.
 */
import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
export declare function interpretPhpImport(captures: CaptureMatch): ParsedImport | null;
export declare function interpretPhpTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
/**
 * Normalize a PHP type string to a simple class identifier, or `null`
 * when the type is uninformative (primitive, void, mixed, self, etc.).
 *
 * Rules applied in order:
 *   1. Strip nullable prefix `?`
 *   2. Split on `|` (union) — keep only if exactly one non-null part
 *   3. Take first part of `&` intersection
 *   4. Strip array suffix `[]`
 *   5. Strip generic wrapper `Collection<User>` → `User`
 *   6. Canonicalize leading backslash off: `\App\Models\User` → `App\Models\User`
 *   7. Reject PHP primitive / pseudo types
 *
 * The qualified form is preserved on `TypeRef.rawName` so downstream PHP
 * receiver resolution can distinguish `\App\Other\User` from a same-simple-name
 * `User` reachable via `use`. Without this, fully-qualified type hints collapse
 * to ambiguous simple names and resolve against the caller's scope chain
 * instead of the explicit target the source named (Codex PR #1497 review,
 * finding 1).
 */
export declare function normalizePhpType(raw: string): string | null;
