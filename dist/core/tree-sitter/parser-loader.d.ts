import Parser from 'tree-sitter';
import { SupportedLanguages } from '../../_shared/index.js';
/**
 * Introspection over the grammar registry for the ABI load-smoke test
 * (`test/unit/parser-loader-abi.test.ts`, #1922). Returns one descriptor per
 * `SOURCES` row — including the `:tsx` variant — so the smoke can assert that
 * EVERY registered grammar loads (required) or "loads OR cleanly reports
 * unavailable" (optional/vendored). Derived from `SOURCES` so adding a grammar
 * automatically widens the smoke's coverage with no second list to maintain.
 */
export interface GrammarSourceDescriptor {
    key: string;
    optional: boolean;
}
export declare const listGrammarSources: () => GrammarSourceDescriptor[];
export declare const resolveLanguageKey: (language: SupportedLanguages, filePath?: string) => string;
export declare const isLanguageAvailable: (language: SupportedLanguages, filePath?: string) => boolean;
/**
 * True when `language`'s grammar is being treated as unavailable specifically
 * because of the runtime GITNEXUS_SKIP_OPTIONAL_GRAMMARS opt-out — as opposed
 * to a genuinely-missing/broken native binding. Lets callers surface an
 * accurate "skipped on purpose" message instead of a spurious "npm rebuild"
 * recovery hint. Returns false for required grammars and for an absent env.
 */
export declare const isGrammarRuntimeSkipped: (language: SupportedLanguages, filePath?: string) => boolean;
export declare const getLanguageGrammar: (language: SupportedLanguages, filePath?: string) => unknown;
export declare const loadParser: () => Promise<Parser>;
export declare const loadLanguage: (language: SupportedLanguages, filePath?: string) => Promise<void>;
export declare const createParserForLanguage: (language: SupportedLanguages, filePath?: string) => Promise<Parser>;
