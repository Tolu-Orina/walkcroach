import { describe, it, expect } from 'vitest';
import { getCorsHeaders, runWithRequestOrigin } from './http.js';

describe('getCorsHeaders', () => {
  it('echoes chrome-extension Origin even when allowlist is SPA-only', async () => {
    const prev = process.env.CORS_ALLOW_ORIGIN;
    const prevIds = process.env.CHROME_EXTENSION_IDS;
    process.env.CORS_ALLOW_ORIGIN = 'https://walkcroach.conquerorfoundation.com';
    delete process.env.CHROME_EXTENSION_IDS;
    try {
      await runWithRequestOrigin('chrome-extension://abcdefghijklmnop', async () => {
        expect(getCorsHeaders()['access-control-allow-origin']).toBe(
          'chrome-extension://abcdefghijklmnop',
        );
      });
    } finally {
      if (prev === undefined) delete process.env.CORS_ALLOW_ORIGIN;
      else process.env.CORS_ALLOW_ORIGIN = prev;
      if (prevIds === undefined) delete process.env.CHROME_EXTENSION_IDS;
      else process.env.CHROME_EXTENSION_IDS = prevIds;
    }
  });

  it('rejects non-allowlisted extension Origin when CHROME_EXTENSION_IDS is set', async () => {
    const prev = process.env.CORS_ALLOW_ORIGIN;
    const prevIds = process.env.CHROME_EXTENSION_IDS;
    process.env.CORS_ALLOW_ORIGIN = 'https://walkcroach.conquerorfoundation.com';
    process.env.CHROME_EXTENSION_IDS = 'abcdefghijklmnopabcdefghijklmnop';
    try {
      await runWithRequestOrigin('chrome-extension://zzzzzzzzzzzzzzzz', async () => {
        expect(getCorsHeaders()['access-control-allow-origin']).toBe(
          'https://walkcroach.conquerorfoundation.com',
        );
      });
      await runWithRequestOrigin(
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        async () => {
          expect(getCorsHeaders()['access-control-allow-origin']).toBe(
            'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
          );
        },
      );
    } finally {
      if (prev === undefined) delete process.env.CORS_ALLOW_ORIGIN;
      else process.env.CORS_ALLOW_ORIGIN = prev;
      if (prevIds === undefined) delete process.env.CHROME_EXTENSION_IDS;
      else process.env.CHROME_EXTENSION_IDS = prevIds;
    }
  });

  it('echoes allowlisted web Origin', async () => {
    const prev = process.env.CORS_ALLOW_ORIGIN;
    process.env.CORS_ALLOW_ORIGIN = 'https://walkcroach.conquerorfoundation.com';
    try {
      await runWithRequestOrigin(
        'https://walkcroach.conquerorfoundation.com',
        async () => {
          expect(getCorsHeaders()['access-control-allow-origin']).toBe(
            'https://walkcroach.conquerorfoundation.com',
          );
        },
      );
    } finally {
      if (prev === undefined) delete process.env.CORS_ALLOW_ORIGIN;
      else process.env.CORS_ALLOW_ORIGIN = prev;
    }
  });
});
