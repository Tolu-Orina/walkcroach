import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_STORAGE_KEY,
  clearStoredAuth,
  loadStoredAuth,
  persistAuth,
  type StoredAuth,
} from './storage';

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

const STORED: StoredAuth = {
  user: { id: 'u1', displayName: 'Alice', isAnonymous: false },
  token: 'tok123',
};

describe('loadStoredAuth', () => {
  it('returns null when nothing stored', () => {
    expect(loadStoredAuth()).toBeNull();
  });

  it('returns parsed auth when present', () => {
    fakeStore[AUTH_STORAGE_KEY] = JSON.stringify(STORED);
    expect(loadStoredAuth()).toEqual(STORED);
  });

  it('returns null on invalid JSON', () => {
    fakeStore[AUTH_STORAGE_KEY] = '{bad';
    expect(loadStoredAuth()).toBeNull();
  });
});

describe('persistAuth', () => {
  it('writes serialized auth to localStorage', () => {
    persistAuth(STORED);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      AUTH_STORAGE_KEY,
      JSON.stringify(STORED),
    );
  });
});

describe('clearStoredAuth', () => {
  it('removes the key from localStorage', () => {
    clearStoredAuth();
    expect(localStorage.removeItem).toHaveBeenCalledWith(AUTH_STORAGE_KEY);
  });
});
