import type { StoredContract, CrossLink } from './types.js';

export interface MatchResult {
  matched: CrossLink[];
  unmatched: StoredContract[];
}

export function normalizeContractId(id: string): string {
  const colonIdx = id.indexOf('::');
  if (colonIdx === -1) return id;

  const type = id.substring(0, colonIdx);
  const rest = id.substring(colonIdx + 2);

  switch (type) {
    case 'http': {
      const parts = rest.split('::');
      if (parts.length >= 2) {
        const method = parts[0].toUpperCase();
        let pathPart = parts.slice(1).join('::');
        pathPart = pathPart.replace(/\/+$/, '');
        return `http::${method}::${pathPart}`;
      }
      return id;
    }
    case 'grpc': {
      const slashIdx = rest.indexOf('/');
      if (slashIdx > 0) {
        const pkg = rest.substring(0, slashIdx).toLowerCase();
        const method = rest.substring(slashIdx);
        return `grpc::${pkg}${method}`;
      }
      if (slashIdx === 0) {
        // Malformed "package/method" with leading slash — do not lowercase the whole string
        // (method segment is case-sensitive per spec).
        return `grpc::${rest}`;
      }
      // No slash: spec is ambiguous (package-only vs full service.method). MVP: lowercase
      // the whole token; differs from pkg/method split above where RPC method keeps case.
      return `grpc::${rest.toLowerCase()}`;
    }
    case 'topic':
      return `topic::${rest.trim().toLowerCase()}`;
    case 'lib':
      return `lib::${rest.toLowerCase()}`;
    default:
      return id;
  }
}

function findMatchingKeys(contractId: string, index: Map<string, StoredContract[]>): string[] {
  const normalized = normalizeContractId(contractId);
  if (index.has(normalized)) return [normalized];

  if (normalized.startsWith('http::*::')) {
    const pathPart = normalized.substring('http::*::'.length);
    const matches: string[] = [];
    for (const key of index.keys()) {
      if (key.startsWith('http::') && key.endsWith(`::${pathPart}`)) {
        matches.push(key);
      }
    }
    return matches;
  }

  return [];
}

export function runExactMatch(contracts: StoredContract[]): MatchResult {
  const providers = contracts.filter((c) => c.role === 'provider');
  const consumers = contracts.filter((c) => c.role === 'consumer');

  const providerIndex = new Map<string, StoredContract[]>();
  for (const p of providers) {
    const key = normalizeContractId(p.contractId);
    const list = providerIndex.get(key) || [];
    list.push(p);
    providerIndex.set(key, list);
  }

  const matched: CrossLink[] = [];
  const matchedConsumerIds = new Set<string>();
  const matchedProviderIds = new Set<string>();

  for (const consumer of consumers) {
    const matchingKeys = findMatchingKeys(consumer.contractId, providerIndex);
    if (matchingKeys.length === 0) continue;

    const allMatchingProviders = matchingKeys.flatMap((k) => providerIndex.get(k) || []);
    for (const provider of allMatchingProviders) {
      if (provider.repo === consumer.repo) {
        if (!provider.service || !consumer.service || provider.service === consumer.service) {
          continue;
        }
      }

      matched.push({
        from: {
          repo: consumer.repo,
          service: consumer.service,
          symbolUid: consumer.symbolUid,
          symbolRef: consumer.symbolRef,
        },
        to: {
          repo: provider.repo,
          service: provider.service,
          symbolUid: provider.symbolUid,
          symbolRef: provider.symbolRef,
        },
        type: consumer.type,
        contractId: consumer.contractId,
        matchType: 'exact',
        confidence: 1.0,
      });

      matchedConsumerIds.add(`${consumer.repo}::${consumer.contractId}`);
      matchedProviderIds.add(`${provider.repo}::${provider.contractId}`);
    }
  }

  const unmatched = contracts.filter((c) => {
    const id = `${c.repo}::${c.contractId}`;
    return c.role === 'provider' ? !matchedProviderIds.has(id) : !matchedConsumerIds.has(id);
  });

  return { matched, unmatched };
}
