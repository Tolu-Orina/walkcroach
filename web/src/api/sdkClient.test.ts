import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STORAGE_KEY } from '../auth/storage';
import { getSdkAccessToken } from './sdkClient';

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

describe('sdkClient auth token selection', () => {
  it('returns undefined when signed out', () => {
    expect(getSdkAccessToken()).toBeUndefined();
  });

  it('prefers Cognito accessToken over idToken', () => {
    fakeStore[AUTH_STORAGE_KEY] = JSON.stringify({
      user: { id: 'u1', displayName: 'Alice', isAnonymous: false },
      token: 'id-as-token',
      cognito: {
        idToken: 'id-token',
        accessToken: 'access-token',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    });
    expect(getSdkAccessToken()).toBe('access-token');
  });

  it('falls back to idToken when accessToken missing', () => {
    fakeStore[AUTH_STORAGE_KEY] = JSON.stringify({
      user: { id: 'u1', displayName: 'Alice', isAnonymous: false },
      token: 'legacy',
      cognito: {
        idToken: 'id-only',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    });
    expect(getSdkAccessToken()).toBe('id-only');
  });
});
