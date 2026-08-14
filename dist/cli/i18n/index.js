import { cliResources } from './resources.js';
let overrideLanguage = null;
function normalizeCliLanguage(raw) {
    const normalized = raw.trim().split('.')[0]?.replace(/_/g, '-').toLowerCase() ?? '';
    if (!normalized)
        return 'en';
    // GitNexus currently ships Simplified Chinese only. Do not map Traditional
    // Chinese locales (zh-TW/zh-HK/zh-Hant) to zh-CN just because they start
    // with "zh".
    if (normalized === 'zh' ||
        normalized === 'zh-cn' ||
        normalized.startsWith('zh-cn-') ||
        normalized === 'zh-hans' ||
        normalized.startsWith('zh-hans-')) {
        return 'zh-CN';
    }
    return 'en';
}
export function detectCliLanguage(env = process.env) {
    const raw = env.GITNEXUS_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
    return normalizeCliLanguage(raw);
}
export function setCliLanguage(language) {
    overrideLanguage = language;
}
export function getCliLanguage() {
    return overrideLanguage ?? detectCliLanguage();
}
export function t(key, vars = {}) {
    const language = getCliLanguage();
    const count = typeof vars.count === 'number' && Number.isFinite(vars.count) ? vars.count : null;
    const pluralKey = count === null ? null : `${String(key)}_${count === 1 ? 'one' : 'other'}`;
    const template = (pluralKey ? (cliResources[language][pluralKey] ?? cliResources.en[pluralKey]) : undefined) ??
        cliResources[language][key] ??
        cliResources.en[key] ??
        key;
    return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, name) => {
        const value = vars[name];
        return value === undefined || value === null ? '' : String(value);
    });
}
