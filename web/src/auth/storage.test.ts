import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_STORAGE_KEY,
  clearStoredAuth,
  clearUserBoundStorage,
  loadStoredAuth,
  persistAuth,
  type StoredAuth,
} from './storage';

const fakeStore: Record<string, string> = {};

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    get length() {
      return Object.keys(fakeStore).length;
    },
    key: vi.fn((i: number) => Object.keys(fakeStore)[i] ?? null),
    getItem: vi.fn((k: string) => fakeStore[k] ?? null),
    setItem: vi.fn((k: string, v: string) => {
      fakeStore[k] = v;
    }),
    removeItem: vi.fn((k: string) => {
      delete fakeStore[k];
    }),
  });
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
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

describe('clearUserBoundStorage', () => {
  it('clears auth and session caches but keeps theme', () => {
    fakeStore[AUTH_STORAGE_KEY] = JSON.stringify(STORED);
    fakeStore['walkcroach.welcome.v1'] = '1';
    fakeStore['walkcroach.chat.session.v1.abc'] = '{}';
    fakeStore['walkcroach.session.v1.proj'] = '{}';
    fakeStore['walkcroach.lastBuilderProjectId'] = 'p1';
    fakeStore['walkcroach.theme.v1'] = 'dark';

    clearUserBoundStorage();

    expect(fakeStore[AUTH_STORAGE_KEY]).toBeUndefined();
    expect(fakeStore['walkcroach.welcome.v1']).toBeUndefined();
    expect(fakeStore['walkcroach.chat.session.v1.abc']).toBeUndefined();
    expect(fakeStore['walkcroach.session.v1.proj']).toBeUndefined();
    expect(fakeStore['walkcroach.lastBuilderProjectId']).toBeUndefined();
    expect(fakeStore['walkcroach.theme.v1']).toBe('dark');
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(
      'walkcroach.signup.pending.v1',
    );
  });
});
