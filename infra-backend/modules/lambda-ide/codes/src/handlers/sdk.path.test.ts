import { describe, expect, it } from 'vitest';
import {
  MEMORY_ASOF_RETENTION_SECONDS,
  SDK_CAPABILITIES,
  SDK_ROOT_SEGMENTS,
} from '../sdk-contract.js';
import { isSdkPath, normalizeSdkPath } from './sdk.js';

describe('normalizeSdkPath', () => {
  it('strips one or more leading /v1 segments', () => {
    expect(normalizeSdkPath('/v1/keys')).toBe('/keys');
    expect(normalizeSdkPath('/v1/v1/memory/recall')).toBe('/memory/recall');
    expect(normalizeSdkPath('/keys')).toBe('/keys');
  });
});

describe('isSdkPath', () => {
  it.each([
    ['/v1/keys', true],
    ['/keys', true],
    ['/v1/memory/recall', true],
    ['/memory/entries', true],
    ['/v1/health', true],
    ['/sdk-health', true],
    ['/v1/sdk-health', true],
    ['/v1/content/publish', true],
    ['/v1/runs/abc', true],
    ['/ide/v1/health', false],
    ['/ide/v1/memory/mirror', false],
    ['/projects', false],
    ['/chrome/v1/health', false],
  ] as const)('%s → %s', (path, expected) => {
    expect(isSdkPath(path)).toBe(expected);
  });

  it('root segments stay aligned with the contract constant', () => {
    expect([...SDK_ROOT_SEGMENTS].sort()).toEqual(
      ['content', 'health', 'keys', 'memory', 'runs', 'sdk-health'].sort(),
    );
  });
});

describe('sdk contract constants', () => {
  it('retention matches migration 034 (90000s)', () => {
    expect(MEMORY_ASOF_RETENTION_SECONDS).toBe(90_000);
  });

  it('advertises a stable capability set', () => {
    expect(SDK_CAPABILITIES).toContain('memory:asOf');
    expect(SDK_CAPABILITIES).toContain('memory:export');
    expect(SDK_CAPABILITIES).toContain('keys:manage');
  });
});
