import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasCompletedWelcome,
  markWelcomeComplete,
  sessionFromCognitoTokens,
  WELCOME_STORAGE_KEY,
} from './session';
import type { CognitoTokens } from './cognito';

const fakeStore: Record<string, string> = {};

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((k: string) => fakeStore[k] ?? null),
    setItem: vi.fn((k: string, v: string) => {
      fakeStore[k] = v;
    }),
    removeItem: vi.fn((k: string) => {
      delete fakeStore[k];
    }),
  });
});

afterEach(() => {
  for (const k of Object.keys(fakeStore)) delete fakeStore[k];
  vi.restoreAllMocks();
});

function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload));
  return `header.${b64}.sig`;
}

describe('sessionFromCognitoTokens', () => {
  it('builds StoredAuth from Cognito tokens', () => {
    const tokens: CognitoTokens = {
      accessToken: 'acc',
      idToken: fakeIdToken({ sub: 'user-42', email: 'a@b.c', name: 'Alice' }),
      refreshToken: 'ref',
      expiresAt: 9999,
    };
    const result = sessionFromCognitoTokens(tokens);
    expect(result.user.id).toBe('user-42');
    expect(result.user.displayName).toBe('Alice');
    expect(result.user.isAnonymous).toBe(false);
    expect(result.token).toBe('acc');
    expect(result.cognito?.refreshToken).toBe('ref');
  });

  it('falls back displayName to email when name absent', () => {
    const tokens: CognitoTokens = {
      accessToken: 'acc',
      idToken: fakeIdToken({ sub: 's1', email: 'x@y.z' }),
      refreshToken: 'r',
      expiresAt: 1,
    };
    expect(sessionFromCognitoTokens(tokens).user.displayName).toBe('x@y.z');
  });

  it('falls back displayName to Builder when both absent', () => {
    const tokens: CognitoTokens = {
      accessToken: 'acc',
      idToken: fakeIdToken({ sub: 's2' }),
      refreshToken: 'r',
      expiresAt: 1,
    };
    expect(sessionFromCognitoTokens(tokens).user.displayName).toBe('Builder');
  });
});

describe('hasCompletedWelcome', () => {
  it('returns false when key absent', () => {
    expect(hasCompletedWelcome()).toBe(false);
  });

  it('returns true when key is "1"', () => {
    fakeStore[WELCOME_STORAGE_KEY] = '1';
    expect(hasCompletedWelcome()).toBe(true);
  });
});

describe('markWelcomeComplete', () => {
  it('sets welcome key to "1"', () => {
    markWelcomeComplete();
    expect(localStorage.setItem).toHaveBeenCalledWith(WELCOME_STORAGE_KEY, '1');
  });
});
