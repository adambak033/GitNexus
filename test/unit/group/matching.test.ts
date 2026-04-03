import { describe, it, expect } from 'vitest';
import { runExactMatch, normalizeContractId } from '../../../src/core/group/matching.js';
import type { StoredContract } from '../../../src/core/group/types.js';

describe('normalizeContractId', () => {
  it('lowercases HTTP method', () => {
    expect(normalizeContractId('http::get::/api/users')).toBe('http::GET::/api/users');
  });

  it('strips trailing slash from HTTP path', () => {
    expect(normalizeContractId('http::GET::/api/users/')).toBe('http::GET::/api/users');
  });

  it('lowercases gRPC package', () => {
    expect(normalizeContractId('grpc::Hr.UserService/GetUser')).toBe(
      'grpc::hr.userservice/GetUser',
    );
  });

  it('preserves case for malformed gRPC id with leading slash (no full-string lowercasing)', () => {
    expect(normalizeContractId('grpc::/MyPkg/DoThing')).toBe('grpc::/MyPkg/DoThing');
  });

  it('trims and lowercases topic', () => {
    expect(normalizeContractId('topic::  Employee.Hired  ')).toBe('topic::employee.hired');
  });

  it('lowercases lib package coordinates', () => {
    expect(normalizeContractId('lib::@Hr/Common::UserDTO')).toBe('lib::@hr/common::userdto');
  });
});

describe('runExactMatch', () => {
  const makeContract = (
    id: string,
    role: 'provider' | 'consumer',
    repo: string,
  ): StoredContract => ({
    contractId: id,
    type: 'http',
    role,
    symbolUid: `uid-${repo}-${id}`,
    symbolRef: { filePath: `src/${repo}.ts`, name: `fn-${id}` },
    symbolName: `fn-${id}`,
    confidence: 0.8,
    meta: {},
    repo,
  });

  it('matches provider and consumer with same contract ID', () => {
    const contracts: StoredContract[] = [
      makeContract('http::GET::/api/users', 'provider', 'backend'),
      makeContract('http::GET::/api/users', 'consumer', 'frontend'),
    ];

    const { matched, unmatched } = runExactMatch(contracts);

    expect(matched).toHaveLength(1);
    expect(matched[0].contractId).toBe('http::GET::/api/users');
    expect(matched[0].matchType).toBe('exact');
    expect(matched[0].confidence).toBe(1.0);
    expect(matched[0].from.repo).toBe('frontend');
    expect(matched[0].to.repo).toBe('backend');
    expect(unmatched).toHaveLength(0);
  });

  it('handles multiple consumers for one provider', () => {
    const contracts: StoredContract[] = [
      makeContract('http::GET::/api/users', 'provider', 'backend'),
      makeContract('http::GET::/api/users', 'consumer', 'frontend'),
      makeContract('http::GET::/api/users', 'consumer', 'bff'),
    ];

    const { matched } = runExactMatch(contracts);
    expect(matched).toHaveLength(2);
  });

  it('reports unmatched contracts', () => {
    const contracts: StoredContract[] = [
      makeContract('http::GET::/api/users', 'provider', 'backend'),
      makeContract('http::GET::/api/orphan', 'consumer', 'frontend'),
    ];

    const { matched, unmatched } = runExactMatch(contracts);
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(2);
  });

  it('normalizes contract IDs before matching', () => {
    const contracts: StoredContract[] = [
      makeContract('http::GET::/api/users/', 'provider', 'backend'),
      makeContract('http::get::/api/users', 'consumer', 'frontend'),
    ];

    const { matched } = runExactMatch(contracts);
    expect(matched).toHaveLength(1);
  });

  it('does not match contracts within the same repo', () => {
    const contracts: StoredContract[] = [
      makeContract('http::GET::/api/users', 'provider', 'backend'),
      makeContract('http::GET::/api/users', 'consumer', 'backend'),
    ];

    const { matched } = runExactMatch(contracts);
    expect(matched).toHaveLength(0);
  });

  it('matches same-repo contracts with different service boundaries', () => {
    const contracts: StoredContract[] = [
      {
        ...makeContract('http::GET::/api/users', 'provider', 'monorepo'),
        service: 'services/auth',
      },
      {
        ...makeContract('http::GET::/api/users', 'consumer', 'monorepo'),
        service: 'services/gateway',
      },
    ];

    const { matched } = runExactMatch(contracts);
    expect(matched).toHaveLength(1);
    expect(matched[0].from.repo).toBe('monorepo');
    expect(matched[0].to.repo).toBe('monorepo');
    expect(matched[0].from.service).toBe('services/gateway');
    expect(matched[0].to.service).toBe('services/auth');
  });

  it('does not match same-repo contracts with same service', () => {
    const contracts: StoredContract[] = [
      {
        ...makeContract('http::GET::/api/users', 'provider', 'monorepo'),
        service: 'services/auth',
      },
      {
        ...makeContract('http::GET::/api/users', 'consumer', 'monorepo'),
        service: 'services/auth',
      },
    ];

    const { matched } = runExactMatch(contracts);
    expect(matched).toHaveLength(0);
  });

  it('does not match same-repo when only one has service', () => {
    const contracts: StoredContract[] = [
      {
        ...makeContract('http::GET::/api/users', 'provider', 'monorepo'),
        service: 'services/auth',
      },
      makeContract('http::GET::/api/users', 'consumer', 'monorepo'),
    ];

    const { matched } = runExactMatch(contracts);
    expect(matched).toHaveLength(0);
  });

  it('cross-repo matching works regardless of service field', () => {
    const contracts: StoredContract[] = [
      { ...makeContract('http::GET::/api/users', 'provider', 'backend'), service: 'services/auth' },
      { ...makeContract('http::GET::/api/users', 'consumer', 'frontend'), service: 'services/web' },
    ];

    const { matched } = runExactMatch(contracts);
    expect(matched).toHaveLength(1);
    expect(matched[0].from.service).toBe('services/web');
    expect(matched[0].to.service).toBe('services/auth');
  });

  it('matches consumer http::*::path to a concrete provider method on that path', () => {
    const contracts: StoredContract[] = [
      makeContract('http::POST::/api/users', 'provider', 'backend'),
      makeContract('http::*::/api/users', 'consumer', 'frontend'),
    ];

    const { matched, unmatched } = runExactMatch(contracts);
    expect(matched).toHaveLength(1);
    expect(matched[0].contractId).toBe('http::*::/api/users');
    expect(matched[0].to.repo).toBe('backend');
    expect(unmatched).toHaveLength(0);
  });
});
