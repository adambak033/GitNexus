/**
 * Creates a lazy-loaded CLI action that defers module import until invocation.
 * The generic constraints ensure the export name is a valid key of the module
 * at compile time — catching typos when used with concrete module imports.
 */
import { checkLbugNative } from '../core/lbug/native-check.js';
function isCallable(value) {
    return typeof value === 'function';
}
export function createLazyAction(loader, exportName) {
    return async (...args) => {
        const module = await loader();
        const action = module[exportName];
        if (!isCallable(action)) {
            throw new Error(`Lazy action export not found: ${exportName}`);
        }
        await action(...args);
    };
}
export function createLbugLazyAction(loader, exportName) {
    return async (...args) => {
        const check = checkLbugNative();
        if (!check.ok) {
            process.stderr.write(`\n  ${check.message?.replace(/\n/g, '\n  ')}\n\n`);
            process.exitCode = 1;
            return;
        }
        const module = await loader();
        const action = module[exportName];
        if (!isCallable(action)) {
            throw new Error(`Lazy action export not found: ${exportName}`);
        }
        await action(...args);
    };
}
/**
 * Analyze-specific lazy action. Unlike the generic LadybugDB wrapper, this
 * captures the complete analyzer receipt before probing/loading native code or
 * evaluating the analyzer module graph. The target export receives that start
 * receipt as its first argument and threads it to runFullAnalysis.
 */
export function createAnalyzerLbugLazyAction(identityLoader, loader, exportName, analyzerModuleUrl) {
    return async (...args) => {
        const identityModule = await identityLoader();
        const prepared = await identityModule.captureAnalyzerIdentityBeforeLoad(analyzerModuleUrl, async () => {
            const check = checkLbugNative();
            if (!check.ok)
                return { check, module: null };
            return { check, module: await loader() };
        });
        if (!prepared.loaded.check.ok) {
            process.stderr.write(`\n  ${prepared.loaded.check.message?.replace(/\n/g, '\n  ')}\n\n`);
            process.exitCode = 1;
            return;
        }
        const action = prepared.loaded.module?.[exportName];
        if (!isCallable(action)) {
            throw new Error(`Lazy action export not found: ${exportName}`);
        }
        await action(prepared.runnerIdentity, ...args);
    };
}
