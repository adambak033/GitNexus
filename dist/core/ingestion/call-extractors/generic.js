// gitnexus/src/core/ingestion/call-extractors/generic.ts
import { inferCallForm, extractReceiverName, extractReceiverNode, extractMixedChain, countCallArguments, } from '../utils/call-analysis.js';
/**
 * Create a CallExtractor from a declarative config.
 */
export function createCallExtractor(config) {
    return {
        language: config.language,
        extract(callNode, callNameNode) {
            // ── Path 1: Language-specific call site ──────────────────────────
            // Non-standard call shapes (e.g. Java `::` method references) are
            // handled entirely by the config hook.  When it returns a result,
            // the generic path is skipped — no argCount, no mixed chain.
            //
            // Note: `extractLanguageCallSite` is called on every `extract()`
            // invocation — both `extract(callNode, undefined)` (parse-worker
            // Path 1) and `extract(callNode, callNameNode)` (Path 2).
            // Language hooks must therefore be idempotent and cheap (e.g. a
            // single node-type check).
            if (config.extractLanguageCallSite) {
                const seed = config.extractLanguageCallSite(callNode);
                if (seed) {
                    return {
                        ...seed,
                        ...(config.typeAsReceiverHeuristic ? { typeAsReceiverHeuristic: true } : {}),
                    };
                }
            }
            // ── Path 2: Generic extraction via @call.name ────────────────────
            if (!callNameNode)
                return null;
            const calledName = callNameNode.text;
            const callForm = inferCallForm(callNode, callNameNode);
            let receiverName = callForm === 'member' ? extractReceiverName(callNameNode) : undefined;
            let receiverMixedChain;
            // When the receiver is a complex expression (call chain, field chain,
            // or mixed), extractReceiverName returns undefined.  Walk the receiver
            // node to build a unified mixed chain for deferred resolution.
            if (callForm === 'member' && receiverName === undefined) {
                const receiverNode = extractReceiverNode(callNameNode);
                if (receiverNode) {
                    const extracted = extractMixedChain(receiverNode);
                    if (extracted && extracted.chain.length > 0) {
                        receiverMixedChain = extracted.chain;
                        receiverName = extracted.baseReceiverName;
                    }
                }
            }
            return {
                calledName,
                ...(callForm !== undefined ? { callForm } : {}),
                ...(receiverName !== undefined ? { receiverName } : {}),
                argCount: countCallArguments(callNode),
                ...(receiverMixedChain !== undefined ? { receiverMixedChain } : {}),
                ...(config.typeAsReceiverHeuristic ? { typeAsReceiverHeuristic: true } : {}),
            };
        },
    };
}
