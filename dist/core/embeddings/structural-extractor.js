/**
 * Structural Extractor Module
 *
 * Reuses ingestion pipeline's AST-based MethodExtractor / FieldExtractor
 * to extract method and field names for embedding text generation.
 */
import { getProviderForFile } from '../ingestion/languages/index.js';
import { buildTypeEnv } from '../ingestion/type-env.js';
import { ensureAndParse, findDeclarationNode } from './ast-utils.js';
const NOOP_SYMBOL_TABLE = {
    lookupExactAll: () => [],
    lookupExact: () => undefined,
    lookupExactFull: () => undefined,
};
/**
 * Extract method and field names from a class/struct/interface node
 * using the ingestion pipeline's AST extractors.
 */
export const extractStructuralNames = async (content, filePath) => {
    const provider = getProviderForFile(filePath);
    if (!provider)
        return { methodNames: [], fieldNames: [] };
    const tree = await ensureAndParse(content, filePath);
    if (!tree)
        return { methodNames: [], fieldNames: [] };
    // Parse node.content (a snippet) — find declaration directly, not by range
    const classNode = findDeclarationNode(tree.rootNode);
    if (!classNode)
        return { methodNames: [], fieldNames: [] };
    const language = provider.id;
    const methodNames = extractMethodNames(classNode, provider, filePath, language);
    const fieldNames = extractFieldNames(classNode, provider, tree, filePath, language);
    return { methodNames, fieldNames };
};
function extractMethodNames(classNode, provider, filePath, language) {
    if (!provider.methodExtractor)
        return [];
    const context = { filePath, language };
    const result = provider.methodExtractor.extract(classNode, context);
    if (!result?.methods?.length)
        return [];
    return result.methods.map((m) => m.name);
}
function extractFieldNames(classNode, provider, tree, filePath, language) {
    if (!provider.fieldExtractor)
        return [];
    const typeEnv = buildTypeEnv(tree, language);
    const context = {
        typeEnv,
        symbolTable: NOOP_SYMBOL_TABLE,
        filePath,
        language,
    };
    const result = provider.fieldExtractor.extract(classNode, context);
    if (!result?.fields?.length)
        return [];
    return result.fields.map((f) => f.name);
}
