import type { ExtractedRoute } from './laravel.js';
declare function isTrpcRouterFile(content: string): boolean;
export declare function extractTrpcRoutes(filePath: string, content: string): ExtractedRoute[];
export { isTrpcRouterFile };
