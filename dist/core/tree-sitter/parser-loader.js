import Parser from 'tree-sitter';
import { createRequire } from 'node:module';
import { SupportedLanguages } from '../../_shared/index.js';
import { logger } from '../logger.js';
import { requireVendoredGrammar } from './vendored-grammars.js';
const _require = createRequire(import.meta.url);
const ISSUES_URL = 'https://github.com/abhigyanpatwari/GitNexus/issues';
const SOURCES = {
    [SupportedLanguages.JavaScript]: {
        load: () => _require('tree-sitter-javascript'),
        unavailableNote: 'JavaScript parsing requires `tree-sitter-javascript`. ' +
            'Check that the package and its native binding installed cleanly (`npm ci`).',
    },
    [SupportedLanguages.TypeScript]: {
        load: () => _require('tree-sitter-typescript').typescript,
        unavailableNote: 'TypeScript parsing requires `tree-sitter-typescript`. ' +
            'Check that the package and its native binding installed cleanly (`npm ci`).',
    },
    [`${SupportedLanguages.TypeScript}:tsx`]: {
        load: () => _require('tree-sitter-typescript').tsx,
        unavailableNote: 'TSX parsing requires `tree-sitter-typescript` (re-uses the same native binding as TS).',
    },
    [SupportedLanguages.Python]: {
        load: () => _require('tree-sitter-python'),
        unavailableNote: 'Python parsing requires `tree-sitter-python`. Check the install and native binding.',
    },
    [SupportedLanguages.Java]: {
        load: () => _require('tree-sitter-java'),
        unavailableNote: 'Java parsing requires `tree-sitter-java`. Check the install and native binding.',
    },
    // tree-sitter-c-sharp declares `type: "module"` with `main: "bindings/node"`
    // (no extension) and no `exports` field, which triggers Node 22's DEP0151
    // deprecation warning on the bare-package import. The explicit subpath
    // bypasses the deprecated ESM main-field resolution. (#1013)
    [SupportedLanguages.CSharp]: {
        load: () => _require('tree-sitter-c-sharp/bindings/node/index.js'),
        unavailableNote: 'C# parsing requires `tree-sitter-c-sharp/bindings/node/index.js`. ' +
            `If the subpath is missing, see ${ISSUES_URL}/1013.`,
    },
    [SupportedLanguages.CPlusPlus]: {
        load: () => _require('tree-sitter-cpp'),
        unavailableNote: 'C++ parsing requires `tree-sitter-cpp`. Check the install and native binding.',
    },
    [SupportedLanguages.Go]: {
        load: () => _require('tree-sitter-go'),
        unavailableNote: 'Go parsing requires `tree-sitter-go`. Check the install and native binding.',
    },
    [SupportedLanguages.Rust]: {
        load: () => _require('tree-sitter-rust'),
        unavailableNote: 'Rust parsing requires `tree-sitter-rust`. Check the install and native binding.',
    },
    [SupportedLanguages.PHP]: {
        load: () => _require('tree-sitter-php').php_only,
        unavailableNote: 'PHP parsing requires `tree-sitter-php` (the `php_only` export). ' +
            'Check the install and native binding.',
    },
    [SupportedLanguages.Ruby]: {
        load: () => _require('tree-sitter-ruby'),
        unavailableNote: 'Ruby parsing requires `tree-sitter-ruby`. Check the install and native binding.',
    },
    [SupportedLanguages.Vue]: {
        load: () => _require('tree-sitter-typescript').typescript,
        unavailableNote: 'Vue parsing piggybacks on `tree-sitter-typescript`. Check the install and native binding.',
    },
    // tree-sitter-c is a core grammar, vendored prebuild-only (under
    // gitnexus/vendor/tree-sitter-c) with GitNexus-built prebuilds for every
    // supported platform-arch — upstream ships only 4/6 (#2116) and C is a
    // required grammar whose source build hard-fails install on a toolchain-less
    // ARM host. Loading through the optional machinery turns a would-be ABI
    // segfault (#1242, #858) into a clean degradation while preserving every
    // other language's analysis. Severity stays `error` because C is not a
    // user-opt-out grammar like Swift/Dart/Kotlin: a failure here is always an
    // install/platform problem the user needs to see.
    [SupportedLanguages.C]: {
        load: () => requireVendoredGrammar('tree-sitter-c'),
        optional: true,
        severity: 'error',
        unavailableNote: 'C parsing disabled: vendored `tree-sitter-c` (under ' +
            '`gitnexus/vendor/tree-sitter-c`) could not be loaded. GitNexus ships ' +
            'prebuilt binaries for all supported platforms (win32/darwin/linux ' +
            'x64+arm64, N-API), so this usually indicates a corrupted install or a ' +
            'native ABI mismatch with the bundled tree-sitter@0.21.1 runtime. ' +
            'Try reinstalling, then re-run analyze. ' +
            `If the failure persists, file details at ${ISSUES_URL}/1242.`,
    },
    // optionalDependencies — may be absent on platforms without prebuilds
    // or when users skip optional installs.
    [SupportedLanguages.Swift]: {
        load: () => requireVendoredGrammar('tree-sitter-swift'),
        optional: true,
        userSkippable: true,
        unavailableNote: 'Swift parsing disabled: vendored `tree-sitter-swift` (under ' +
            '`gitnexus/vendor/tree-sitter-swift`) failed to load. ' +
            'Likely cause: no prebuilt `.node` for this platform/architecture. ' +
            `See ${ISSUES_URL}/1130.`,
    },
    [SupportedLanguages.Dart]: {
        load: () => requireVendoredGrammar('tree-sitter-dart'),
        optional: true,
        userSkippable: true,
        unavailableNote: 'Dart parsing disabled: vendored `tree-sitter-dart` (under ' +
            '`gitnexus/vendor/tree-sitter-dart`) failed to load. ' +
            'Likely cause: native compile failed at install (missing python3/make/g++). ' +
            `See ${ISSUES_URL}/1125.`,
    },
    [SupportedLanguages.Kotlin]: {
        load: () => requireVendoredGrammar('tree-sitter-kotlin'),
        optional: true,
        userSkippable: true,
        unavailableNote: 'Kotlin parsing disabled: vendored `tree-sitter-kotlin` (under ' +
            '`gitnexus/vendor/tree-sitter-kotlin`) failed to load. ' +
            'Likely cause: no prebuilt `.node` for this platform/architecture. ' +
            `See ${ISSUES_URL}/2107.`,
    },
};
export const listGrammarSources = () => Object.entries(SOURCES).map(([key, source]) => ({
    key,
    optional: source.optional === true,
}));
const loadCache = new Map();
const logged = new Set();
// Parsed form of GITNEXUS_SKIP_OPTIONAL_GRAMMARS, resolved lazily ONCE per
// process. The env is set before analyze runs, so re-reading + re-allocating a
// Set on every call was wasted work (and a latent trap for any future per-file
// caller). `vi.resetModules()` gives the unit tests a fresh module — and thus a
// fresh memo — per case, so this stays test-friendly.
//   'all' → every userSkippable grammar; Set → only the named ids
//   (and `tree-sitter-<id>` spellings); null → env unset/empty (nothing).
let _skipDirective;
const skipDirective = () => {
    if (_skipDirective !== undefined)
        return _skipDirective;
    const raw = (process.env.GITNEXUS_SKIP_OPTIONAL_GRAMMARS ?? '').trim().toLowerCase();
    if (raw === '')
        return (_skipDirective = null);
    if (raw === '1' || raw === 'true' || raw === 'all' || raw === '*')
        return (_skipDirective = 'all');
    return (_skipDirective = new Set(raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .flatMap((s) => [s, s.replace(/^tree-sitter-/, '')])));
};
const isRuntimeSkippedGrammar = (key, source) => {
    // Only grammars explicitly flagged user-skippable (swift/dart/kotlin) — never
    // required deps that use the optional machinery for ABI safety (C carries no
    // `userSkippable`).
    if (source.userSkippable !== true)
        return false;
    const directive = skipDirective();
    if (directive === null)
        return false;
    if (directive === 'all')
        return true;
    // `key` is the SupportedLanguages value (e.g. `swift`); the directive Set
    // already holds both the bare id and the `tree-sitter-<id>` spelling.
    return directive.has(key) || directive.has(`tree-sitter-${key}`);
};
const logFailure = (key, result) => {
    if (result.ok === true)
        return;
    if (logged.has(key))
        return;
    logged.add(key);
    const message = `[gitnexus] ${result.note} (${result.error.message})`;
    // Severity routes to the correct pino level. Both go to stderr (pino's
    // default destination), so MCP stdio framing is preserved either way —
    // the level tag drives log filtering, not channel selection.
    if (result.severity === 'error') {
        logger.error(message);
    }
    else {
        logger.warn(message);
    }
};
export const resolveLanguageKey = (language, filePath) => language === SupportedLanguages.TypeScript && filePath?.endsWith('.tsx')
    ? `${language}:tsx`
    : language;
const loadGrammar = (key) => {
    const cached = loadCache.get(key);
    if (cached)
        return cached;
    const source = SOURCES[key];
    if (!source) {
        const result = {
            ok: false,
            error: new Error(`Unsupported language: ${key}`),
            note: `No grammar registered for language key \`${key}\`. Add a row to SOURCES.`,
            fatal: true,
            severity: 'error',
        };
        loadCache.set(key, result);
        return result;
    }
    // Runtime opt-out: treat a user-skipped optional grammar exactly like an
    // absent binding (non-fatal unavailable + one warning), without attempting
    // the native load. See `isRuntimeSkippedGrammar`.
    if (isRuntimeSkippedGrammar(key, source)) {
        // Deliberate opt-out: emit an accurate "disabled on purpose" note rather
        // than `source.unavailableNote` (which blames a missing/unbuilt binding and
        // would mislead a user who set the env intentionally — #2101 review).
        const result = {
            ok: false,
            error: new Error('runtime opt-out'),
            note: `${key} parsing disabled via GITNEXUS_SKIP_OPTIONAL_GRAMMARS (unset it to re-enable).`,
            fatal: false,
            severity: 'warn',
        };
        loadCache.set(key, result);
        logFailure(key, result);
        return result;
    }
    let result;
    try {
        result = { ok: true, grammar: source.load() };
    }
    catch (err) {
        const fatal = !source.optional;
        result = {
            ok: false,
            error: err,
            note: source.unavailableNote,
            fatal,
            severity: source.severity ?? (fatal ? 'error' : 'warn'),
        };
    }
    loadCache.set(key, result);
    if (result.ok === false)
        logFailure(key, result);
    return result;
};
export const isLanguageAvailable = (language, filePath) => loadGrammar(resolveLanguageKey(language, filePath)).ok;
/**
 * True when `language`'s grammar is being treated as unavailable specifically
 * because of the runtime GITNEXUS_SKIP_OPTIONAL_GRAMMARS opt-out — as opposed
 * to a genuinely-missing/broken native binding. Lets callers surface an
 * accurate "skipped on purpose" message instead of a spurious "npm rebuild"
 * recovery hint. Returns false for required grammars and for an absent env.
 */
export const isGrammarRuntimeSkipped = (language, filePath) => {
    const key = resolveLanguageKey(language, filePath);
    const source = SOURCES[key];
    return source !== undefined && isRuntimeSkippedGrammar(key, source);
};
export const getLanguageGrammar = (language, filePath) => {
    const key = resolveLanguageKey(language, filePath);
    const result = loadGrammar(key);
    if (result.ok === true)
        return result.grammar;
    // Fatal failures throw the original underlying error (preserving stack)
    // after the note has been logged. Optional failures fall through to the
    // standard "Unsupported language" message that callers already handle.
    if (result.fatal)
        throw result.error;
    throw new Error(`Unsupported language: ${language}`);
};
let sharedParser = null;
export const loadParser = async () => (sharedParser ??= new Parser());
export const loadLanguage = async (language, filePath) => {
    const parser = await loadParser();
    parser.setLanguage(getLanguageGrammar(language, filePath));
};
export const createParserForLanguage = async (language, filePath) => {
    const parser = new Parser();
    parser.setLanguage(getLanguageGrammar(language, filePath));
    return parser;
};
