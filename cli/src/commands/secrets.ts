/**
 * `walkcroach secrets` (C1.5) — replaces hand-editing `~/.walkcroach/secrets.json`.
 *
 * Two rules shape the whole command:
 *
 *  1. **A secret is never a flag value.** clig.dev: "Do not read secrets
 *     directly from flags." A flag lands in shell history, in `ps` output
 *     while the process runs, and in any CI log that echoes the command. The
 *     value comes from stdin or a TTY prompt, never `--value`.
 *  2. **`list` prints keys, never values.** The question it answers is "is
 *     this configured", which needs no secret on screen.
 *
 * Keys are constrained to `SECRET_KEYS`, which the IDE reads from the same
 * store (cross-surface rule X5) — a free-form key here would write something
 * no other surface would ever look for.
 */
import { createInterface } from 'node:readline/promises';
import { SECRET_KEYS } from '@walkcroach/agent-engine';
import {
  deleteSecret,
  getSecret,
  loadSecrets,
  secretsPath,
  setSecret,
} from '../lib/config.js';
import { credentialBackend, keychainGet } from '../lib/credential-store.js';
import { EXIT, exitCodeForError } from '../lib/exit-codes.js';
import { OutputSink } from '../lib/output.js';
import { inputAllowed } from '../lib/runtime.js';

/**
 * Keys a user may set here.
 *
 * The Cognito tokens are deliberately absent: they are written by
 * `auth login` and pasting one by hand is the workflow C1.1 replaced.
 */
export const SETTABLE_SECRETS = {
  'mcp.url': SECRET_KEYS.mcpUrl,
  'mcp.clusterId': SECRET_KEYS.mcpClusterId,
  'mcp.apiKey': SECRET_KEYS.mcpApiKey,
  'ccloud.apiKey': SECRET_KEYS.ccloudApiKey,
  'bedrock.apiKey': SECRET_KEYS.bedrockApiKey,
} as const;

export type SettableSecret = keyof typeof SETTABLE_SECRETS;

export function isSettableSecret(key: string): key is SettableSecret {
  return Object.prototype.hasOwnProperty.call(SETTABLE_SECRETS, key);
}

function unknownKeyError(key: string): string {
  return `Unknown secret "${key}". Allowed: ${Object.keys(SETTABLE_SECRETS).join(', ')}`;
}

/** Read a value from piped stdin, so `… | walkcroach secrets set k --stdin` works. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

export async function secretsSet(
  key: string,
  opts: { stdin?: boolean; json?: boolean },
): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  if (!isSettableSecret(key)) {
    sink.result(false, { error: unknownKeyError(key) });
    return EXIT.USAGE;
  }

  try {
    let value: string;
    if (opts.stdin) {
      value = await readStdin();
    } else if (inputAllowed()) {
      // stderr for the prompt so `--json` output on stdout stays parseable.
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      value = (await rl.question(`Value for ${key} (input is not echoed to logs): `)).trim();
      rl.close();
    } else {
      sink.result(false, {
        error: `Pipe the value and pass --stdin: echo "…" | walkcroach secrets set ${key} --stdin`,
      });
      return EXIT.USAGE;
    }

    if (!value) {
      sink.result(false, { error: 'No value provided' });
      return EXIT.USAGE;
    }

    await setSecret(SETTABLE_SECRETS[key], value);
    // Never echo the value back, not even truncated.
    sink.command('secrets.set', {
      ok: true,
      key,
      backend: credentialBackend(),
      path: secretsPath(),
    });
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}

export async function secretsList(opts: { json?: boolean }): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  try {
    const stored = await loadSecrets();
    const secrets = await Promise.all(
      (Object.keys(SETTABLE_SECRETS) as SettableSecret[]).map(async (key) => ({
        key,
        // `getSecret` also consults the environment, so "configured" reflects
        // what a run would actually see — not just what is on disk.
        set: Boolean(await getSecret(SETTABLE_SECRETS[key])),
        source: process.env[
          `WALKCROACH_${SETTABLE_SECRETS[key].replace(/\./g, '_').toUpperCase()}`
        ]
          ? 'env'
          : keychainGet(SETTABLE_SECRETS[key]) !== undefined
            ? 'keychain'
            : stored[SETTABLE_SECRETS[key]]
              ? 'file'
              : null,
      })),
    );
    sink.command('secrets.list', {
      backend: credentialBackend(),
      path: secretsPath(),
      secrets,
    });
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}

export async function secretsRemove(
  key: string,
  opts: { json?: boolean },
): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  if (!isSettableSecret(key)) {
    sink.result(false, { error: unknownKeyError(key) });
    return EXIT.USAGE;
  }
  try {
    await deleteSecret(SETTABLE_SECRETS[key]);
    sink.command('secrets.rm', { ok: true, key });
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}
