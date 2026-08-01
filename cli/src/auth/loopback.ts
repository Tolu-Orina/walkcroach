/**
 * One-shot loopback listener for the browser sign-in handoff (C1.1a).
 *
 * RFC 8252 §7.3 prescribes a loopback redirect for native apps: plain HTTP is
 * acceptable precisely because the request never leaves the machine.
 *
 * ## The ordering that matters
 *
 * The port is bound *before* the browser is opened, and the returned
 * `redirectUri` is derived from the bound port. That closes the race where
 * another local process could claim the port between us publishing a redirect
 * URI and the browser hitting it — only one process can hold a TCP port, so
 * whoever binds first owns the callback. Publishing a port we do not yet hold
 * would invert that guarantee.
 *
 * ## What the listener will accept
 *
 * Exactly one request, on exactly `/callback`, and only if it carries the
 * `state` we generated. Everything else gets a 404 and does not resolve the
 * wait. The socket closes as soon as a verdict is reached — a listener left
 * open after sign-in is an open door for no benefit.
 *
 * ## Residual risk, and what closed it
 *
 * A local process that wins the port race before us could receive a code and
 * the state that goes with it, since both travel in the callback URL. Binding
 * first is what prevents that, not the state check.
 *
 * That was the whole of the risk while the code alone was redeemable. It no
 * longer is: the exchange requires a PKCE verifier (RFC 7636) that is generated
 * in `session.ts`, held only in memory, and never placed in the authorize URL,
 * the callback URL, or on disk. A racing process can now obtain a code it cannot
 * spend. Binding first remains the first line of defence — this is defence in
 * depth, not a replacement for it.
 */
import { createServer, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AddressInfo } from 'node:net';

/** Loopback address to bind. Never `0.0.0.0`, which would be reachable. */
const HOST = '127.0.0.1';

export type LoopbackListener = {
  /** The exact redirect URI to send to Web, including the bound port. */
  redirectUri: string;
  /** The CSRF state, held in memory only and never written to disk. */
  state: string;
  /** Resolves with the authorization code once the browser calls back. */
  waitForCode: () => Promise<string>;
  /** Idempotent; safe to call from a `finally`. */
  close: () => Promise<void>;
};

export function newState(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison, so a mismatch leaks nothing through timing. */
export function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const PAGE = (title: string, detail: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>WalkCroach</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;
       min-height:100vh;background:#0e0f11;color:#e8e6e3}
  main{max-width:28rem;padding:2rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:0;color:#a8a29e}
</style></head>
<body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;

export async function startLoopbackListener(opts?: {
  /** How long to wait for the browser before giving up. */
  timeoutMs?: number;
}): Promise<LoopbackListener> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const state = newState();

  let resolveCode: ((code: string) => void) | undefined;
  let rejectCode: ((err: Error) => void) | undefined;
  let settled = false;
  let timer: NodeJS.Timeout | undefined;

  const server: Server = createServer((req, res) => {
    // Any request that is not our callback is noise — a browser probing for a
    // favicon, or something else on the machine scanning ports.
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state') ?? '';

    if (error) {
      respond(res, 400, 'Sign-in cancelled', 'You can close this tab and try again.');
      finish(new Error(`Sign-in failed: ${error}`));
      return;
    }
    if (!returnedState || !statesMatch(returnedState, state)) {
      // Hard failure, no retry. A callback we cannot tie to the request we
      // made is either a stale tab or someone else's, and neither is a
      // reason to accept a code.
      respond(res, 400, 'Sign-in failed', 'The response did not match this sign-in request.');
      finish(new Error('State mismatch — sign-in response did not match this request.'));
      return;
    }
    if (!code) {
      respond(res, 400, 'Sign-in failed', 'The response carried no authorization code.');
      finish(new Error('Sign-in callback carried no authorization code.'));
      return;
    }

    respond(res, 200, 'Signed in', 'You can close this tab and return to your terminal.');
    finish(null, code);
  });

  function respond(
    res: ServerResponse,
    status: number,
    title: string,
    detail: string,
  ): void {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE(title, detail));
  }

  function finish(err: Error | null, code?: string): void {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    // Close after the response has been flushed, so the browser still renders
    // the page telling the user what happened.
    setImmediate(() => server.close());
    if (err) rejectCode?.(err);
    else resolveCode?.(code as string);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Port 0 asks the OS for a free port, which avoids both a collision with
    // something already running and a predictable target.
    server.listen(0, HOST, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not determine the loopback port for sign-in.');
  }

  const redirectUri = `http://${HOST}:${address.port}/callback`;

  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
    timer = setTimeout(() => {
      finish(
        new Error(
          `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser. ` +
            'Use --no-browser to complete sign-in manually.',
        ),
      );
    }, timeoutMs);
    // Do not hold the process open purely for this timer.
    timer.unref?.();
  });

  // The promise is created eagerly so the listener is armed the moment it is
  // bound, which means a caller that closes without ever awaiting it — an
  // error while building the authorize URL, say — would produce an unhandled
  // rejection. Under Node's default that terminates the process, turning a
  // recoverable sign-in failure into a crash. Marking it handled here costs
  // nothing: anyone who does await `waitForCode()` still sees the rejection.
  codePromise.catch(() => undefined);

  return {
    redirectUri,
    state,
    waitForCode: () => codePromise,
    async close() {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        rejectCode?.(new Error('Sign-in cancelled.'));
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
