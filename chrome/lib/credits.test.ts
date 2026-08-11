import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCredits } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchCredits', () => {
  it('returns ok for a signed-in ledger', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        remaining: 40,
        allowance: 50,
        resetsAt: '2026-09-01T00:00:00.000Z',
        plan: 'free',
      }),
    );
    await expect(fetchCredits('tok')).resolves.toEqual({
      status: 'ok',
      balance: {
        remaining: 40,
        allowance: 50,
        resetsAt: '2026-09-01T00:00:00.000Z',
        plan: 'free',
      },
    });
  });

  it('returns signed-out for device/anon requiresSignIn', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        requiresSignIn: true,
        remaining: 0,
        allowance: 0,
        plan: 'free',
      }),
    );
    await expect(fetchCredits('tok')).resolves.toEqual({
      status: 'signed-out',
    });
  });

  it('returns error on HTTP failure instead of soft-null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('nope', { status: 503 }),
    );
    const result = await fetchCredits('tok');
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toMatch(/503/);
    expect(result.message).toMatch(/Try again/i);
    }
  });

  it('returns error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new TypeError('Failed to fetch'),
    );
    await expect(fetchCredits('tok')).resolves.toEqual({
      status: 'error',
      message:
        'Can’t reach the WalkCroach service. Check your network, then try again.',
    });
  });

  it('returns error on malformed body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ remaining: 'x' }),
    );
    const result = await fetchCredits('tok');
    expect(result).toEqual({
      status: 'error',
      message:
        'Couldn’t load credits. Check your connection, then try again.',
    });
  });
});
