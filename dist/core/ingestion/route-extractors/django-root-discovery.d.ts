import type { DjangoFileReader } from './django.js';
/**
 * Given a dotted Python module path, produce possible file paths.
 * e.g. `cmrMngt.settings` → `['cmrMngt/settings.py', 'cmrMngt/settings/__init__.py']`
 */
export declare function djangoModuleToFilePaths(modulePath: string): string[];
/**
 * Discover the Django root URL file(s) by following, for EVERY `manage.py` in
 * the file set:
 *   manage.py → DJANGO_SETTINGS_MODULE → settings → ROOT_URLCONF → urls.py
 *
 * Returns one root urls path per discoverable Django project, so a monorepo
 * with several `manage.py` files (e.g. `serviceA/manage.py`, `serviceB/manage.py`)
 * yields every project's routes rather than only the first.
 *
 * @param files Array of file paths (content optional — when absent, `reader`
 *   resolves it on demand).
 * @param contentMap Optional pre-built map of file path → content.
 * @param reader Optional disk-backed reader for files not present in the map.
 * @returns De-duplicated relative paths to each project's root URL file (empty if none).
 */
export declare function discoverDjangoRootUrls(files: Array<{
    path: string;
    content?: string;
}>, contentMap?: Map<string, string>, reader?: DjangoFileReader): string[];
