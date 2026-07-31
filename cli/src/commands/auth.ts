import { SECRET_KEYS } from '@walkcroach/agent-engine';
import {
  deleteSecret,
  getSecret,
  loadConfig,
  resolveApiBaseUrl,
  saveConfig,
  setSecret,
  walkcroachHome,
} from '../lib/config.js';
import { EXIT, exitCodeForError } from '../lib/exit-codes.js';
import { inputAllowed } from '../lib/runtime.js';
import { ideHealth, ideMe } from '../lib/api.js';
import { OutputSink } from '../lib/output.js';
import { browserSignIn } from '../auth/session.js';

/**
 * Sign in (C1.1).
 *
 * Browser handoff by default; `--token` and `WALKCROACH_ACCESS_TOKEN` remain
 * exactly as they were, because CI must never be made to open a browser
 * (clig.dev: never *require* interaction, always offer a flag). `--no-browser`
 * prints the URL for SSH and headless machines, where the listener still works
 * over a forwarded port.
 */
export async function authLogin(opts: {
  json?: boolean;
  token?: string;
  browser?: boolean;
  timeoutMs?: number;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');

  // An explicitly supplied but blank `--token` is a mistake worth naming, not
  // a reason to quietly start a different flow than the one that was asked for.
  if (opts.token !== undefined && !opts.token.trim()) {
    sink.result(false, { error: 'No token provided' });
    return EXIT.USAGE;
  }

  const explicit = opts.token?.trim() || process.env.WALKCROACH_ACCESS_TOKEN?.trim();
  if (explicit) {
    await setSecret(SECRET_KEYS.cognitoAccessToken, explicit);
    sink.command('auth.login', {
      ok: true,
      method: 'token',
      home: walkcroachHome(),
    });
    return EXIT.OK;
  }

  // No TTY means no one is sitting at this terminal — a CI job, a cron, a
  // piped script. Launching a browser there would hang for the full two-minute
  // timeout waiting for a human who does not exist, so refuse immediately and
  // name the two flags that do work. `--no-browser` is the deliberate
  // exception: asking for the URL is asking to complete it out of band.
  if (!inputAllowed() && opts.browser !== false) {
    sink.result(false, {
      error:
        'No interactive terminal. Pass --token, set WALKCROACH_ACCESS_TOKEN, ' +
        'or use --no-browser to print the sign-in URL.',
    });
    return EXIT.USAGE;
  }

  try {
    const result = await browserSignIn({
      openBrowser: opts.browser !== false,
      timeoutMs: opts.timeoutMs,
      onUrl: (url) => {
        // stderr: this is progress, not output a script would parse.
        process.stderr.write(
          opts.browser === false
            ? `Open this URL to sign in:\n\n  ${url}\n\nWaiting…\n`
            : `Opening your browser to sign in…\n  ${url}\n`,
        );
      },
    });
    sink.command('auth.login', {
      ok: true,
      method: 'browser',
      // The token itself is never printed; the sink would scrub it anyway.
      expiresIn: result.tokens.expires_in ?? null,
      home: walkcroachHome(),
    });
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}

export async function authLogout(opts: { json?: boolean }): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  await deleteSecret(SECRET_KEYS.cognitoAccessToken);
  await deleteSecret(SECRET_KEYS.cognitoRefreshToken);
  await deleteSecret(SECRET_KEYS.cognitoIdToken);
  await deleteSecret(SECRET_KEYS.cognitoExpiresAt);
  sink.command('auth.logout', { ok: true });
  return EXIT.OK;
}

export async function authStatus(opts: { json?: boolean }): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  const token = await getSecret(SECRET_KEYS.cognitoAccessToken);
  let me: unknown = null;
  let health: unknown = null;
  try {
    health = await ideHealth();
  } catch (err) {
    health = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (token) {
    try {
      me = await ideMe(token);
    } catch (err) {
      me = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const api = await resolveApiBaseUrl();
  sink.command('auth.status', {
    signedIn: Boolean(token),
    apiBaseUrl: api.value,
    apiBaseUrlSource: api.source,
    health,
    me,
    home: walkcroachHome(),
  });
  return EXIT.OK;
}

export async function configShow(opts: { json?: boolean }): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  sink.command('config', await loadConfig());
  return EXIT.OK;
}

export async function configSet(
  key: string,
  value: string,
  opts: { json?: boolean },
): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  const allowed = [
    'apiBaseUrl',
    'cognitoHostedUiUrl',
    'cognitoClientId',
    'cognitoRegion',
    'defaultAutonomy',
    'bedrockRegion',
  ] as const;
  if (!allowed.includes(key as (typeof allowed)[number])) {
    sink.result(false, {
      error: `Unknown config key. Allowed: ${allowed.join(', ')}`,
    });
    return EXIT.USAGE;
  }
  const next = await saveConfig({ [key]: value });
  sink.command('config.set', next);
  return EXIT.OK;
}
