import type { AnalysisFeatureDescriptor } from '../../../analysis-features.js';

/** Durable completeness contract for Java Spring configuration bindings. */
export const SPRING_CONFIG_BINDINGS_FEATURE: AnalysisFeatureDescriptor = {
  id: 'spring.config-bindings',
  version: 1,
  // Annotation presence is content-derived, so the conservative upgrade gate
  // is every Java repository. This guarantees the first analyzer version that
  // ships bindings performs a full rebuild even when config files are absent
  // (missing @Value placeholders still need their unresolved marker).
  appliesTo: (filePaths) => filePaths.some((filePath) => filePath.toLowerCase().endsWith('.java')),
};
