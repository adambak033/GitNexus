// gitnexus/src/core/ingestion/heritage-extractors/generic.ts
import { normalizeSupertypeName } from './supertype-alternation.js';
/**
 * Create a HeritageExtractor from a declarative config or a language enum.
 *
 * When a full HeritageExtractionConfig is provided, custom hooks
 * (shouldSkipExtends, callBasedHeritage) drive the extraction.
 * When only a SupportedLanguages value is provided, the factory produces
 * a default extractor that handles the standard @heritage.* captures.
 */
export function createHeritageExtractor(config) {
    const actualConfig = typeof config === 'string' ? { language: config } : config;
    const callNameSet = actualConfig.callBasedHeritage?.callNames;
    return {
        language: actualConfig.language,
        extract(captureMap, context) {
            const classNode = captureMap['heritage.class'];
            if (!classNode)
                return [];
            // Normalize the declared class name too: most grammars expose a plain
            // identifier here (text == normalized), but a few use a qualified/scoped
            // node (e.g. Ruby `class Foo::Bar`), which must collapse to the simple
            // name so it matches the symbol table.
            const className = normalizeSupertypeName(classNode);
            if (!className)
                return [];
            const results = [];
            const extendsNode = captureMap['heritage.extends'];
            if (extendsNode) {
                if (!actualConfig.shouldSkipExtends?.(extendsNode)) {
                    const parentName = normalizeSupertypeName(extendsNode);
                    if (parentName)
                        results.push({ className, parentName, kind: 'extends' });
                }
            }
            const implementsNode = captureMap['heritage.implements'];
            if (implementsNode) {
                const parentName = normalizeSupertypeName(implementsNode);
                if (parentName)
                    results.push({ className, parentName, kind: 'implements' });
            }
            const traitNode = captureMap['heritage.trait'];
            if (traitNode) {
                const parentName = normalizeSupertypeName(traitNode);
                if (parentName)
                    results.push({ className, parentName, kind: 'trait-impl' });
            }
            return results;
        },
        ...(callNameSet
            ? {
                extractFromCall(calledName, callNode, context) {
                    if (!callNameSet.has(calledName))
                        return null;
                    return actualConfig.callBasedHeritage.extract(calledName, callNode, context.filePath);
                },
            }
            : {}),
    };
}
