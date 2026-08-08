import { describe, expect, it } from 'vitest';
import { creditHeaders, jsonResponse } from './http.js';

describe('jsonResponse', () => {
  it('always emits x-request-id', () => {
    const res = jsonResponse(200, { ok: true });
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('preserves a caller-supplied x-request-id', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const res = jsonResponse(200, { ok: true }, { 'x-request-id': id });
    expect(res.headers['x-request-id']).toBe(id);
  });

  it('cannot strip correlation via empty extra header', () => {
    const res = jsonResponse(200, { ok: true }, { 'x-request-id': '   ' });
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('exposes correlation and credit headers on CORS', () => {
    const res = jsonResponse(200, {});
    const expose = res.headers['access-control-expose-headers'];
    expect(expose).toContain('x-request-id');
    expect(expose).toContain('x-ratelimit-remaining');
    expect(expose).toContain('x-credits-cost');
  });
});

describe('creditHeaders', () => {
  it('emits limit / remaining / cost', () => {
    expect(creditHeaders({ remaining: 42, limit: 100, cost: 1 })).toEqual({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '42',
      'x-credits-cost': '1',
    });
  });
});
