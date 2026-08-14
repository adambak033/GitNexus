/**
 * Go package-clause resolution — the single derivation of a file's package
 * identity (#2837).
 *
 * Both Go passes that bucket files by package (`populateGoWorkspaceOwners` and
 * `populateGoPackageSiblings`) previously carried their own byte-identical copy
 * of this, spelled as one unanchored multiline regex:
 *
 *     sourceText.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_]*)/m)
 *
 * With the `m` flag that matches the first line ANYWHERE in the file starting
 * with `package <ident>` — comment bodies included. Measured against that exact
 * expression: a header comment containing `package legacy_notes kept for
 * history` yields `legacy_notes`, and an indented `  package helper old name`
 * yields `helper`. A file that mis-infers its own package gets a bucket key no
 * sibling shares, so it is isolated in BOTH passes: its methods never attach to
 * structs declared in sibling files, and it exchanges no same-package bindings.
 * Every field-receiver call in it then resolves to nothing, silently — the same
 * per-file signature #2837 reported.
 *
 * The Go spec makes the correct rule exact rather than heuristic: a source
 * file's first non-comment, non-blank token is `package`. So skip the leading
 * run of whitespace and comments, then require the very next token to be the
 * clause. Anything else is `null` — a truncated read, a misrouted non-Go file,
 * an unparseable header — reported by the caller rather than guessed at.
 *
 * ONE rule governs every leniency below (the `\s+` separator, the shebang skip,
 * CR-only line endings): a file this returns `null` for is dropped from BOTH
 * passes, so refusing a shape the previous regex accepted is a silent
 * regression, not a principled tightening. Be no stricter than the grammar.
 */
/**
 * The package name declared by this Go source text, or `null` when its first
 * real token is not a package clause.
 *
 * Only the leading run before the clause is skipped — deliberately NOT a
 * whole-file comment strip, which would be O(file) on every Go file and would
 * also have to model string literals to stay correct.
 */
export declare function inferGoPackageName(sourceText: string): string | null;
/**
 * The directory half of a Go package key. Go package identity is
 * directory-scoped, so repeated `package main` directories must not see each
 * other's unqualified names.
 */
export declare function goPackageDir(filePath: string): string;
