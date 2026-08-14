/**
 * Entry Point Scoring
 *
 * Calculates entry point scores for process detection based on:
 * 1. Call ratio (existing algorithm - callees / (callers + 1))
 * 2. Export status (exported functions get higher priority)
 * 3. Name patterns (functions matching entry point patterns like handle*, on*, *Controller)
 * 4. Framework detection (path-based detection for Next.js, Express, Django, etc.)
 *
 * This module is language-agnostic - language-specific patterns are defined per language.
 */
import { detectFrameworkFromPath } from './framework-detection.js';
import { providers } from './languages/index.js';
// ============================================================================
// NAME PATTERNS
// ============================================================================
/**
 * Universal entry point naming patterns shared across all languages.
 * Per-language patterns live on each LanguageProvider.entryPointPatterns.
 */
const UNIVERSAL_ENTRY_POINT_PATTERNS = [
    /^(main|init|bootstrap|start|run|setup|configure)$/i,
    /^handle[A-Z]/, // handleLogin, handleSubmit
    /^on[A-Z]/, // onClick, onSubmit
    /Handler$/, // RequestHandler
    /Controller$/, // UserController
    /^process[A-Z]/, // processPayment
    /^execute[A-Z]/, // executeQuery
    /^perform[A-Z]/, // performAction
    /^dispatch[A-Z]/, // dispatchEvent
    /^trigger[A-Z]/, // triggerAction
    /^fire[A-Z]/, // fireEvent
    /^emit[A-Z]/, // emitEvent
];
/** Pre-computed merged patterns (universal + language-specific) from providers. */
const MERGED_ENTRY_POINT_PATTERNS = Object.fromEntries(Object.entries(providers).map(([lang, provider]) => [
    lang,
    [...UNIVERSAL_ENTRY_POINT_PATTERNS, ...(provider.entryPointPatterns ?? [])],
]));
// ============================================================================
// UTILITY PATTERNS - Functions that should be penalized
// ============================================================================
/**
 * Patterns that indicate utility/helper functions (NOT entry points)
 * These get penalized in scoring
 */
const UTILITY_PATTERNS = [
    /^(get|set|is|has|can|should|will|did)[A-Z]/, // Accessors/predicates
    /^_/, // Private by convention
    /^(format|parse|validate|convert|transform)/i, // Transformation utilities
    /^(log|debug|error|warn|info)$/i, // Logging
    /^(to|from)[A-Z]/, // Conversions
    /^(encode|decode)/i, // Encoding utilities
    /^(serialize|deserialize)/i, // Serialization
    /^(clone|copy|deep)/i, // Cloning utilities
    /^(merge|extend|assign)/i, // Object utilities
    /^(filter|map|reduce|sort|find)/i, // Collection utilities (standalone)
    /Helper$/,
    /Util$/,
    /Utils$/,
    /^utils?$/i,
    /^helpers?$/i,
];
// ============================================================================
// MAIN SCORING FUNCTION
// ============================================================================
/**
 * Calculate an entry point score for a function/method
 *
 * Higher scores indicate better entry point candidates.
 * Score = baseScore × exportMultiplier × nameMultiplier
 *
 * @param name - Function/method name
 * @param language - Programming language
 * @param isExported - Whether the function is exported/public
 * @param callerCount - Number of functions that call this function
 * @param calleeCount - Number of functions this function calls
 * @returns Score and array of reasons explaining the score
 */
export function calculateEntryPointScore(name, language, isExported, callerCount, calleeCount, filePath = '') {
    const reasons = [];
    // Must have outgoing calls to be an entry point (we need to trace forward)
    if (calleeCount === 0) {
        return { score: 0, reasons: ['no-outgoing-calls'] };
    }
    // Base score: call ratio (existing algorithm)
    // High ratio = calls many, called by few = likely entry point
    const baseScore = calleeCount / (callerCount + 1);
    reasons.push(`base:${baseScore.toFixed(2)}`);
    // Export bonus: exported/public functions are more likely entry points
    const exportMultiplier = isExported ? 2.0 : 1.0;
    if (isExported) {
        reasons.push('exported');
    }
    // Name pattern scoring
    let nameMultiplier = 1.0;
    // #trpc-fork: tRPC procedures often use accessor-style names
    // (`getX`, `setX`, `isX`) that legitimately ARE entry points. Without this
    // exemption, the 0.3× utility penalty cancels the 3.0× tRPC framework boost
    // (net 0.9, below baseline), preventing procedures like `setProviderCap`
    // from becoming Process entry points and hiding them from `query` results.
    // The exemption is scoped to tRPC router files only — non-router files still
    // pay the utility penalty so genuine utility helpers stay deprioritized.
    const isTrpcRouter = filePath && /\/(routers|trpc\/routers|server\/routers)\//i.test(filePath.replace(/\\/g, '/'));
    const skipUtilityPenalty = isTrpcRouter && detectFrameworkFromPath(filePath).framework === 'trpc';
    // Check negative patterns first (utilities get penalized)
    if (!skipUtilityPenalty && UTILITY_PATTERNS.some((p) => p.test(name))) {
        nameMultiplier = 0.3; // Significant penalty
        reasons.push('utility-pattern');
    }
    else {
        // Check positive patterns
        const allPatterns = MERGED_ENTRY_POINT_PATTERNS[language];
        if (allPatterns?.some((p) => p.test(name))) {
            nameMultiplier = 1.5; // Bonus for matching entry point pattern
            reasons.push('entry-pattern');
        }
    }
    // Framework detection bonus (Phase 2)
    let frameworkMultiplier = 1.0;
    if (filePath) {
        const frameworkHint = detectFrameworkFromPath(filePath);
        if (frameworkHint) {
            frameworkMultiplier = frameworkHint.entryPointMultiplier;
            reasons.push(`framework:${frameworkHint.reason}`);
        }
    }
    // Calculate final score
    const finalScore = baseScore * exportMultiplier * nameMultiplier * frameworkMultiplier;
    return {
        score: finalScore,
        reasons,
    };
}
// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
/**
 * Check if a file path is a test file (should be excluded from entry points)
 * Covers common test file patterns across all supported languages
 */
export function isTestFile(filePath) {
    const p = filePath.toLowerCase().replace(/\\/g, '/');
    return (
    // JavaScript/TypeScript test patterns
    p.includes('.test.') ||
        p.includes('.spec.') ||
        p.includes('__tests__/') ||
        p.includes('__mocks__/') ||
        // Generic test folders
        p.includes('/test/') ||
        p.includes('/tests/') ||
        p.includes('/testing/') ||
        // Python test patterns
        p.endsWith('_test.py') ||
        p.includes('/test_') ||
        // Go test patterns
        p.endsWith('_test.go') ||
        // Java test patterns
        p.includes('/src/test/') ||
        // Rust test patterns (inline tests are different, but test files)
        p.includes('/tests/') ||
        // Swift/iOS test patterns
        p.endsWith('tests.swift') ||
        p.endsWith('test.swift') ||
        p.includes('uitests/') ||
        // C# test patterns
        p.endsWith('tests.cs') ||
        p.endsWith('test.cs') ||
        p.includes('.tests/') ||
        p.includes('.test/') ||
        p.includes('.integrationtests/') ||
        p.includes('.unittests/') ||
        p.includes('/testproject/') ||
        // PHP/Laravel test patterns
        p.endsWith('test.php') ||
        p.endsWith('spec.php') ||
        p.includes('/tests/feature/') ||
        p.includes('/tests/unit/') ||
        // Ruby test patterns
        p.endsWith('_spec.rb') ||
        p.endsWith('_test.rb') ||
        p.includes('/spec/') ||
        p.includes('/test/fixtures/'));
}
/**
 * Check if a file path is likely a utility/helper file
 * These might still have entry points but should be lower priority
 */
export function isUtilityFile(filePath) {
    const p = filePath.toLowerCase().replace(/\\/g, '/');
    return (p.includes('/utils/') ||
        p.includes('/util/') ||
        p.includes('/helpers/') ||
        p.includes('/helper/') ||
        p.includes('/common/') ||
        p.includes('/shared/') ||
        p.includes('/lib/') ||
        p.endsWith('/utils.ts') ||
        p.endsWith('/utils.js') ||
        p.endsWith('/helpers.ts') ||
        p.endsWith('/helpers.js') ||
        p.endsWith('_utils.py') ||
        p.endsWith('_helpers.py'));
}
