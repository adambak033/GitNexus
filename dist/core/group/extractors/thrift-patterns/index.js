import * as path from 'node:path';
import { JAVA_THRIFT_PLUGIN } from './java.js';
const REGISTRY = {
    '.java': JAVA_THRIFT_PLUGIN,
};
export const THRIFT_SCAN_GLOB = '**/*.java';
export function getPluginForFile(rel) {
    const ext = path.extname(rel).toLowerCase();
    return REGISTRY[ext];
}
