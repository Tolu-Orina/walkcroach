import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getStoredTheme, initTheme, resolveTheme } from './theme';

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
  vi.stubGlobal('document', {
    documentElement: { dataset: {} as Record<string, string> },
  });
  // Default to an OS with no dark preference. Individual tests override this —
  // `resolveTheme` follows prefers-color-scheme, so leaving matchMedia
  // unstubbed silently tested whatever jsdom happens to return.
  stubPrefersDark(false);
});

function stubPrefersDark(dark: boolean): void {
  vi.stubGlobal('window', {
    matchMedia: vi.fn((query: string) => ({
      matches: dark && query.includes('prefers-color-scheme: dark'),
      media: query,
    })),
  });
}

afterEach(() => {
  for (const k of Object.keys(fakeStore)) delete fakeStore[k];
  vi.restoreAllMocks();
});

describe('getStoredTheme', () => {
  it('returns null when nothing stored', () => {
    expect(getStoredTheme()).toBeNull();
  });

  it('returns "dark" when stored', () => {
    fakeStore['walkcroach.theme.v1'] = 'dark';
    expect(getStoredTheme()).toBe('dark');
  });

  it('returns "light" when stored', () => {
    fakeStore['walkcroach.theme.v1'] = 'light';
    expect(getStoredTheme()).toBe('light');
  });

  it('returns null for invalid value', () => {
    fakeStore['walkcroach.theme.v1'] = 'blue';
    expect(getStoredTheme()).toBeNull();
  });
});

describe('resolveTheme', () => {
  it('follows a dark OS preference when nothing is stored', () => {
    stubPrefersDark(true);
    expect(resolveTheme()).toBe('dark');
  });

  it('follows a light OS preference when nothing is stored', () => {
    stubPrefersDark(false);
    expect(resolveTheme()).toBe('light');
  });

  it('returns stored theme when available', () => {
    fakeStore['walkcroach.theme.v1'] = 'light';
    expect(resolveTheme()).toBe('light');
  });
});

describe('applyTheme', () => {
  it('sets dataset and persists', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.setItem).toHaveBeenCalledWith('walkcroach.theme.v1', 'light');
  });
});

describe('initTheme', () => {
  it('applies resolved theme and returns it', () => {
    fakeStore['walkcroach.theme.v1'] = 'light';
    expect(initTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows the OS preference when nothing is stored', () => {
    stubPrefersDark(true);
    expect(initTheme()).toBe('dark');
  });

  it('lets a stored preference override the OS', () => {
    stubPrefersDark(true);
    fakeStore['walkcroach.theme.v1'] = 'light';
    expect(initTheme()).toBe('light');
  });
});
