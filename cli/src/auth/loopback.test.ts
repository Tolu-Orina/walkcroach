/**
 * The loopback listener, exercised over real HTTP against a real bound port.
 *
 * Mocking the server here would test nothing that matters: the properties
 * worth asserting are that the port is genuinely held before the URL exists,
 * that a callback we cannot tie to our own request is refused, and that the
 * socket does not outlive the sign-in.
 */
import { describe, expect, it } from 'vitest';
import { connect } from 'node:net';
import { startLoopbackListener, newState, statesMatch } from './loopback.js';

async function get(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

/** True if something is accepting TCP connections on the port. */
function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function portOf(redirectUri: string): number {
  return Number(new URL(redirectUri).port);
}

describe('startLoopbackListener', () => {
  it('binds loopback on a free high port before returning a URL', async () => {
    const listener = await startLoopbackListener();
    try {
      const url = new URL(listener.redirectUri);
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('127.0.0.1');
      expect(url.pathname).toBe('/callback');
      expect(Number(url.port)).toBeGreaterThan(1023);
      // The URL is only safe to publish because the port is already ours —
      // otherwise another process could take it before the browser arrives.
      expect(await portIsOpen(portOf(listener.redirectUri))).toBe(true);
    } finally {
      await listener.close();
    }
  });

  it('accepts the code when the state matches', async () => {
    const listener = await startLoopbackListener();
    const waiting = listener.waitForCode();
    const res = await get(
      `${listener.redirectUri}?code=auth_code_1&state=${encodeURIComponent(listener.state)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain('Signed in');
    await expect(waiting).resolves.toBe('auth_code_1');
    await listener.close();
  });

  it('refuses a callback whose state does not match, and keeps no code', async () => {
    const listener = await startLoopbackListener();
    const waiting = listener.waitForCode();
    const res = await get(`${listener.redirectUri}?code=stolen&state=not-our-state`);
    expect(res.status).toBe(400);
    await expect(waiting).rejects.toThrow(/State mismatch/);
    await listener.close();
  });

  it('refuses a callback carrying no state at all', async () => {
    const listener = await startLoopbackListener();
    const waiting = listener.waitForCode();
    const res = await get(`${listener.redirectUri}?code=stolen`);
    expect(res.status).toBe(400);
    await expect(waiting).rejects.toThrow(/State mismatch/);
    await listener.close();
  });

  it('reports a provider error instead of waiting for a code that will not come', async () => {
    const listener = await startLoopbackListener();
    const waiting = listener.waitForCode();
    await get(`${listener.redirectUri}?error=access_denied&state=${listener.state}`);
    await expect(waiting).rejects.toThrow(/access_denied/);
    await listener.close();
  });

  it('rejects a matching state with no code', async () => {
    const listener = await startLoopbackListener();
    const waiting = listener.waitForCode();
    const res = await get(`${listener.redirectUri}?state=${listener.state}`);
    expect(res.status).toBe(400);
    await expect(waiting).rejects.toThrow(/no authorization code/);
    await listener.close();
  });

  it('ignores requests to any other path', async () => {
    const listener = await startLoopbackListener();
    const waiting = listener.waitForCode();
    const base = new URL(listener.redirectUri).origin;
    expect((await get(`${base}/favicon.ico`)).status).toBe(404);
    expect((await get(`${base}/`)).status).toBe(404);

    // Still waiting: noise on the port must not settle the sign-in.
    const settled = await Promise.race([
      waiting.then(() => 'settled').catch(() => 'settled'),
      new Promise((r) => setTimeout(() => r('pending'), 50)),
    ]);
    expect(settled).toBe('pending');
    await listener.close();
    await expect(waiting).rejects.toThrow(/cancelled/);
  });

  it('closes the port once sign-in completes', async () => {
    const listener = await startLoopbackListener();
    const port = portOf(listener.redirectUri);
    const waiting = listener.waitForCode();
    await get(`${listener.redirectUri}?code=c&state=${listener.state}`);
    await waiting;
    await listener.close();
    // A listener left open after sign-in is an open door for no benefit.
    expect(await portIsOpen(port)).toBe(false);
  });

  it('gives up rather than waiting forever', async () => {
    const listener = await startLoopbackListener({ timeoutMs: 60 });
    await expect(listener.waitForCode()).rejects.toThrow(/Timed out/);
    await listener.close();
  });

  it('uses a fresh, unguessable state per sign-in', async () => {
    const a = await startLoopbackListener();
    const b = await startLoopbackListener();
    try {
      expect(a.state).not.toBe(b.state);
      // 32 random bytes, base64url — long enough that guessing is not a path.
      expect(a.state.length).toBeGreaterThanOrEqual(43);
      expect(a.state).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(portOf(a.redirectUri)).not.toBe(portOf(b.redirectUri));
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe('statesMatch', () => {
  it('matches only an exact value', () => {
    const s = newState();
    expect(statesMatch(s, s)).toBe(true);
    expect(statesMatch(s, `${s}x`)).toBe(false);
    expect(statesMatch(s, s.slice(0, -1))).toBe(false);
    expect(statesMatch(s, '')).toBe(false);
  });
});
