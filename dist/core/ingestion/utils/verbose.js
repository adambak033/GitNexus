import { parseTruthyEnv } from './env.js';
export const isVerboseIngestionEnabled = () => parseTruthyEnv(process.env.GITNEXUS_VERBOSE);
