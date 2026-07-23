import { describe, it, expect } from 'vitest';
import {
  originFromUrl,
  ensureOriginPermission,
  revokeOrigin,
  listGrantedOrigins,
  hasOriginPermission,
} from './permissions';

describe('originFromUrl', () => {
  it('extracts https origin pattern', async () => {
    expect(await originFromUrl('https://www.example.com/path?q=1')).toBe(
      'https://www.example.com/*',
    );
  });

  it('extracts http origin pattern', async () => {
    expect(await originFromUrl('http://localhost:3000/api')).toBe(
      'http://localhost:3000/*',
    );
  });

  it('handles URL with port', async () => {
    expect(await originFromUrl('https://app.test:8443/foo')).toBe(
      'https://app.test:8443/*',
    );
  });
});

describe('activeTab-only permissions helpers', () => {
  it('ensureOriginPermission always returns true', async () => {
    expect(await ensureOriginPermission('https://example.com/page')).toBe(true);
  });

  it('hasOriginPermission is always false (no host grants)', async () => {
    expect(await hasOriginPermission('https://example.com/*')).toBe(false);
  });

  it('listGrantedOrigins is always empty', async () => {
    expect(await listGrantedOrigins()).toEqual([]);
  });

  it('revokeOrigin is a no-op false', async () => {
    expect(await revokeOrigin('https://example.com/*')).toBe(false);
  });
});
