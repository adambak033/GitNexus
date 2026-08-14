/**
 * Generic table-driven heritage extractor factory.
 *
 * Follows the same config+factory pattern as method-extractors/generic.ts,
 * field-extractors/generic.ts, call-extractors/generic.ts, and
 * variable-extractors/generic.ts.
 *
 * Languages with custom extraction hooks (Go: shouldSkipExtends, Ruby:
 * callBasedHeritage) pass a full HeritageExtractionConfig.  Languages
 * that use the default capture-based extraction can pass just the
 * SupportedLanguages enum value — no per-language config file needed.
 */
import type { SupportedLanguages } from '../../../_shared/index.js';
import type { HeritageExtractionConfig, HeritageExtractor } from '../heritage-types.js';
/**
 * Create a HeritageExtractor from a declarative config or a language enum.
 *
 * When a full HeritageExtractionConfig is provided, custom hooks
 * (shouldSkipExtends, callBasedHeritage) drive the extraction.
 * When only a SupportedLanguages value is provided, the factory produces
 * a default extractor that handles the standard @heritage.* captures.
 */
export declare function createHeritageExtractor(config: HeritageExtractionConfig | SupportedLanguages): HeritageExtractor;
