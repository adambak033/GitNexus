import type { MethodInfo } from '../method-types.js';

/**
 * Compute arity for ID-generation purposes.
 * Returns `undefined` when any parameter is variadic (arity is indeterminate).
 */
export function arityForIdFromInfo(info: MethodInfo): number | undefined {
  return info.parameters.some((p) => p.isVariadic) ? undefined : info.parameters.length;
}

/** Convert MethodInfo from methodExtractor into flat properties for a graph node. */
export function buildMethodProps(info: MethodInfo): Record<string, unknown> {
  const types: string[] = [];
  let optionalCount = 0;
  let hasVariadic = false;
  for (const p of info.parameters) {
    if (p.type !== null) types.push(p.type);
    if (p.isOptional) optionalCount++;
    if (p.isVariadic) hasVariadic = true;
  }
  return {
    parameterCount: hasVariadic ? undefined : info.parameters.length,
    ...(!hasVariadic && optionalCount > 0
      ? { requiredParameterCount: info.parameters.length - optionalCount }
      : {}),
    ...(types.length > 0 ? { parameterTypes: types } : {}),
    returnType: info.returnType ?? undefined,
    visibility: info.visibility,
    isStatic: info.isStatic,
    isAbstract: info.isAbstract,
    isFinal: info.isFinal,
    ...(info.isVirtual ? { isVirtual: info.isVirtual } : {}),
    ...(info.isOverride ? { isOverride: info.isOverride } : {}),
    ...(info.isAsync ? { isAsync: info.isAsync } : {}),
    ...(info.isPartial ? { isPartial: info.isPartial } : {}),
    ...(info.annotations.length > 0 ? { annotations: info.annotations } : {}),
  };
}
