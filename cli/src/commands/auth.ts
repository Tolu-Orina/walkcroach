import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { SECRET_KEYS } from '@walkcroach/agent-engine';
import {
  deleteSecret,
  getSecret,
  loadConfig,
  saveConfig,
  setSecret,
  walkcroachHome,
} from '../lib/config.js';
import { ideHealth, ideMe } from '../lib/api.js';
import { OutputSink } from '../lib/output.js';

export async function authLogin(opts: {
  json?: boolean;
  token?: string;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  let token = opts.token?.trim();
  if (!token) {
    if (!process.stdin.isTTY) {
      sink.result(false, {
        error:
          'Pass --token or set WALKCROACH_ACCESS_TOKEN (non-interactive login).',
      });
      return 1;
    }
    const rl = createInterface({ input, output });
    token = (await rl.question('Paste Cognito access token: ')).trim();
    rl.close();
  }
  if (!token) {
    sink.result(false, { error: 'No token provided' });
    return 1;
  }
  await setSecret(SECRET_KEYS.cognitoAccessToken, token);
  sink.command('auth.login', { ok: true, home: walkcroachHome() });
  return 0;
}

export async function authLogout(opts: { json?: boolean }): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  await deleteSecret(SECRET_KEYS.cognitoAccessToken);
  await deleteSecret(SECRET_KEYS.cognitoRefreshToken);
  await deleteSecret(SECRET_KEYS.cognitoIdToken);
  sink.command('auth.logout', { ok: true });
  return 0;
}

export async function authStatus(opts: { json?: boolean }): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  const token = await getSecret(SECRET_KEYS.cognitoAccessToken);
  const cfg = await loadConfig();
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
  sink.command('auth.status', {
    signedIn: Boolean(token),
    apiBaseUrl: cfg.apiBaseUrl,
    health,
    me,
    home: walkcroachHome(),
  });
  return 0;
}

export async function configShow(opts: { json?: boolean }): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  sink.command('config', await loadConfig());
  return 0;
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
  ] as const;
  if (!allowed.includes(key as (typeof allowed)[number])) {
    sink.result(false, {
      error: `Unknown config key. Allowed: ${allowed.join(', ')}`,
    });
    return 1;
  }
  const next = await saveConfig({ [key]: value });
  sink.command('config.set', next);
  return 0;
}
