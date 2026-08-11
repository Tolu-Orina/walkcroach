import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureOriginPermission,
  hasOriginPermission,
  isSupportedPageUrl,
  listGrantedOrigins,
  originLabel,
  originPatternFromUrl,
  requestOriginPermission,
  restrictedReason,
  revokeOrigin,
} from './permissions';

/** API_BASE falls back to http://localhost:3002 outside a WXT build. */
const API_ORIGIN = 'http://localhost:3002/*';
/** IDE_API_BASE falls back to http://localhost:3003 outside a WXT build. */
const IDE_ORIGIN = 'http://localhost:3003/*';

type PermissionsMock = {
  contains: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
};

let permissions: PermissionsMock;

beforeEach(() => {
  permissions = {
    contains: vi.fn(async () => false),
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    getAll: vi.fn(async () => ({ origins: [] as string[] })),
  };
  globalThis.chrome = {
    permissions,
  } as unknown as typeof chrome;
});

describe('originPatternFromUrl', () => {
  it('builds a host-exact pattern from https', () => {
    expect(originPatternFromUrl('https://www.example.com/path?q=1')).toBe(
      'https://www.example.com/*',
    );
  });

  it('builds a pattern from http, preserving the port', () => {
    expect(originPatternFromUrl('http://localhost:3000/api')).toBe(
      'http://localhost:3000/*',
    );
    expect(originPatternFromUrl('https://app.test:8443/foo')).toBe(
      'https://app.test:8443/*',
    );
  });

  it('does not widen to a subdomain wildcard', () => {
    // The user grants the site they are looking at, not the whole apex domain.
    expect(originPatternFromUrl('https://jobs.example.com/x')).toBe(
      'https://jobs.example.com/*',
    );
  });

  it('returns null for URLs no extension can ever read', () => {
    expect(originPatternFromUrl('chrome://settings')).toBeNull();
    expect(
      originPatternFromUrl('https://chromewebstore.google.com/detail/abc'),
    ).toBeNull();
    expect(originPatternFromUrl('file:///C:/notes.txt')).toBeNull();
    expect(originPatternFromUrl('not a url')).toBeNull();
  });
});

describe('restrictedReason', () => {
  it('names why a page is unreadable', () => {
    expect(restrictedReason('chrome://extensions')).toBe('scheme');
    expect(restrictedReason('chrome-extension://abc/auth.html')).toBe('scheme');
    expect(restrictedReason('about:blank')).toBe('scheme');
    expect(restrictedReason('devtools://devtools/x')).toBe('scheme');
    expect(restrictedReason('view-source:https://example.com')).toBe('scheme');
    expect(restrictedReason('file:///tmp/a.html')).toBe('local-file');
    expect(restrictedReason('https://chrome.google.com/webstore')).toBe(
      'webstore',
    );
    expect(restrictedReason('¯\\_(ツ)_/¯')).toBe('unparseable');
  });

  it('returns null for ordinary pages', () => {
    expect(restrictedReason('https://example.com/a')).toBeNull();
    expect(restrictedReason('http://example.com/a')).toBeNull();
    expect(isSupportedPageUrl('https://example.com')).toBe(true);
  });
});

describe('originLabel', () => {
  it('strips scheme and glob for user-facing copy', () => {
    expect(originLabel('https://www.example.com/*')).toBe('www.example.com');
    expect(originLabel('http://localhost:3000/*')).toBe('localhost:3000');
  });
});

describe('hasOriginPermission', () => {
  it('delegates to chrome.permissions.contains', async () => {
    permissions.contains.mockResolvedValue(true);
    await expect(hasOriginPermission('https://example.com/*')).resolves.toBe(
      true,
    );
    expect(permissions.contains).toHaveBeenCalledWith({
      origins: ['https://example.com/*'],
    });
  });

  it('reports false rather than throwing when the API rejects', async () => {
    permissions.contains.mockRejectedValue(new Error('boom'));
    await expect(hasOriginPermission('https://example.com/*')).resolves.toBe(
      false,
    );
  });
});

describe('requestOriginPermission', () => {
  it('resolves false when the user declines, without throwing', async () => {
    permissions.request.mockResolvedValue(false);
    await expect(
      requestOriginPermission('https://example.com/*'),
    ).resolves.toBe(false);
  });

  it('requests exactly one origin', async () => {
    await requestOriginPermission('https://example.com/*');
    expect(permissions.request).toHaveBeenCalledWith({
      origins: ['https://example.com/*'],
    });
  });
});

describe('ensureOriginPermission', () => {
  it('skips the prompt when the grant already exists', async () => {
    permissions.contains.mockResolvedValue(true);
    await expect(
      ensureOriginPermission('https://example.com/page'),
    ).resolves.toBe(true);
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it('prompts once when the grant is missing', async () => {
    permissions.contains.mockResolvedValue(false);
    permissions.request.mockResolvedValue(true);
    await expect(
      ensureOriginPermission('https://example.com/page'),
    ).resolves.toBe(true);
    expect(permissions.request).toHaveBeenCalledOnce();
  });

  it('refuses restricted pages without prompting', async () => {
    await expect(ensureOriginPermission('chrome://settings')).resolves.toBe(
      false,
    );
    expect(permissions.request).not.toHaveBeenCalled();
  });
});

describe('listGrantedOrigins', () => {
  it('hides the install-time API host and the optional wildcards', async () => {
    permissions.getAll.mockResolvedValue({
      origins: [
        API_ORIGIN,
        IDE_ORIGIN,
        'https://*/*',
        'http://*/*',
        'https://www.example.com/*',
        'https://acme.test/*',
      ],
    });
    await expect(listGrantedOrigins()).resolves.toEqual([
      'https://acme.test/*',
      'https://www.example.com/*',
    ]);
  });

  it('returns an empty list when nothing is granted', async () => {
    permissions.getAll.mockResolvedValue({ origins: [API_ORIGIN, IDE_ORIGIN] });
    await expect(listGrantedOrigins()).resolves.toEqual([]);
  });
});

describe('revokeOrigin', () => {
  it('removes a granted site', async () => {
    await expect(revokeOrigin('https://example.com/*')).resolves.toBe(true);
    expect(permissions.remove).toHaveBeenCalledWith({
      origins: ['https://example.com/*'],
    });
  });

  it('refuses to revoke the API host the extension needs to function', async () => {
    await expect(revokeOrigin(API_ORIGIN)).resolves.toBe(false);
    expect(permissions.remove).not.toHaveBeenCalled();
  });

  it('refuses to revoke the IDE / SDK host', async () => {
    await expect(revokeOrigin(IDE_ORIGIN)).resolves.toBe(false);
    expect(permissions.remove).not.toHaveBeenCalled();
  });
});
