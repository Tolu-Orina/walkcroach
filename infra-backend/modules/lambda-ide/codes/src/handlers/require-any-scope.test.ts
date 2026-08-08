import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../auth.js';
import { requireAnyScope, requireScope } from './sdk-memory.js';

function keyAuth(scopes: AuthContext['scopes']): AuthContext {
  return {
    ownerId: 'owner-1',
    isAnonymous: false,
    source: 'apikey',
    keyId: 'key-1',
    scopes,
  };
}

describe('requireAnyScope', () => {
  it('allows Cognito (undefined scopes)', () => {
    const auth: AuthContext = {
      ownerId: 'u',
      isAnonymous: false,
      source: 'jwt',
    };
    expect(requireAnyScope(auth, ['memory:read', 'content:run'])).toBeNull();
  });

  it('passes when any listed scope is present', () => {
    expect(
      requireAnyScope(keyAuth(['content:run']), ['memory:read', 'content:run']),
    ).toBeNull();
    expect(
      requireAnyScope(keyAuth(['memory:read']), ['memory:read', 'content:run']),
    ).toBeNull();
  });

  it('denies publish-only keys that lack every acceptable scope', () => {
    const denied = requireAnyScope(keyAuth(['content:run']), ['memory:read']);
    expect(denied?.status).toBe(403);
    expect(denied?.error).toMatch(/memory:read/);
  });

  it('documents the OR matrix used by run poll', () => {
    // content:run alone must poll — this is the P0.1 contract.
    expect(
      requireAnyScope(keyAuth(['content:run']), ['memory:read', 'content:run']),
    ).toBeNull();
    expect(requireScope(keyAuth(['content:run']), 'memory:read')?.status).toBe(
      403,
    );
  });
});
