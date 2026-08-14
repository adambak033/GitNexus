import { cliResources } from './resources.js';
import { en } from './en.js';
export type SupportedCliLanguage = keyof typeof cliResources;
export type CliMessageKey = keyof typeof en;
export type CliMessageVars = Record<string, string | number | boolean | undefined | null>;
export declare function detectCliLanguage(env?: NodeJS.ProcessEnv): SupportedCliLanguage;
export declare function setCliLanguage(language: SupportedCliLanguage | null): void;
export declare function getCliLanguage(): SupportedCliLanguage;
export declare function t(key: CliMessageKey, vars?: CliMessageVars): string;
