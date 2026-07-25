import { describe, it, expect } from 'vitest';
import { getCorsHeaders, runWithRequestOrigin } from './http.js';

describe('getCorsHeaders', () => {
  it('echoes chrome-extension Origin even when allowlist is SPA-only', async () => {
    const prev = process.env.CORS_ALLOW_ORIGIN;
    process.env.CORS_ALLOW_ORIGIN = 'https://walkcroach.conquerorfoundation.com';
    try {
      await runWithRequestOrigin('chrome-extension://abcdefghijklmnop', async () => {
        expect(getCorsHeaders()['access-control-allow-origin']).toBe(
          'chrome-extension://abcdefghijklmnop',
        );
      });
    } finally {
      if (prev === undefined) delete process.env.CORS_ALLOW_ORIGIN;
      else process.env.CORS_ALLOW_ORIGIN = prev;
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
