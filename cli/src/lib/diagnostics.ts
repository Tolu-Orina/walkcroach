/**
 * Environment probes for `walkcroach doctor` (C1.6).
 *
 * Every probe answers a question someone actually asks when a command
 * misbehaves, and every one of them fails soft: `doctor` exists to report the
 * state of a broken environment, so a probe that throws would defeat the
 * command it serves.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  SECRET_KEYS,
  loadPtyModule,
  resolveInferenceCredentials,
  type InferenceCredentials,
} from '@walkcroach/agent-engine';
import { getSecret, loadConfig } from './config.js';

const execFileAsync = promisify(execFile);

export type AuthState = {
  signedIn: boolean;
  /** Present only when a browser sign-in recorded an expiry. */
  expiresAt: string | null;
  expired: boolean;
  hasRefreshToken: boolean;
};

export async function authState(): Promise<AuthState> {
  const token = await getSecret(SECRET_KEYS.cognitoAccessToken);
  const refresh = await getSecret(SECRET_KEYS.cognitoRefreshToken);
  const rawExpiry = await getSecret(SECRET_KEYS.cognitoExpiresAt);
  const expiresAt = Number(rawExpiry);
  const known = Number.isFinite(expiresAt) && expiresAt > 0;
  return {
    signedIn: Boolean(token),
    expiresAt: known ? new Date(expiresAt).toISOString() : null,
    expired: known ? Date.now() > expiresAt : false,
    hasRefreshToken: Boolean(refresh),
  };
}

export type BinaryProbe = { present: boolean; version?: string; error?: string };

/**
 * Is the `ccloud` CLI usable?
 *
 * Runs the binary rather than scanning `PATH` by hand, because "on PATH" and
 * "actually runs" differ often enough to matter — a broken shim resolves
 * fine and fails on use. Bounded so a hung binary cannot hang `doctor`.
 */
export async function ccloudProbe(timeoutMs = 3000): Promise<BinaryProbe> {
  try {
    const { stdout } = await execFileAsync('ccloud', ['version'], {
      timeout: timeoutMs,
      windowsHide: true,
    });
    return { present: true, version: stdout.trim().split('\n')[0] };
  } catch (err) {
    return {
      present: false,
      error: err instanceof Error ? err.message.split('\n')[0] : String(err),
    };
  }
}

export type McpProbe = {
  configured: boolean;
  url: string | null;
  hasApiKey: boolean;
  clusterId: string | null;
};

/**
 * MCP configuration, without contacting the server.
 *
 * Reporting configuration rather than reachability is the deliberate choice:
 * a probe request would need credentials and could have side effects, and the
 * question `doctor` is really being asked is "did my `secrets set` land".
 */
export async function mcpProbe(): Promise<McpProbe> {
  const url = (await getSecret(SECRET_KEYS.mcpUrl)) ?? null;
  const apiKey = await getSecret(SECRET_KEYS.mcpApiKey);
  const clusterId = (await getSecret(SECRET_KEYS.mcpClusterId)) ?? null;
  return {
    configured: Boolean(url && apiKey),
    url,
    hasApiKey: Boolean(apiKey),
    clusterId,
  };
}

/**
 * Which terminal backend a run would get.
 *
 * `node-pty` is an optional native dependency; without it the engine falls
 * back to pipes, which cannot drive a REPL or a full-screen program. Knowing
 * which one is live explains a whole class of "the terminal tool behaved
 * oddly" reports.
 */
export async function ptyBackend(): Promise<'pty' | 'pipe'> {
  try {
    const mod = await loadPtyModule();
    return mod ? 'pty' : 'pipe';
  } catch {
    return 'pipe';
  }
}

/**
 * Which credentials a run would use for inference, and in which region (§4A).
 *
 * BYOK makes this the first question when a run fails on auth, and the second
 * when an AWS bill looks wrong: the CLI can be calling Bedrock as the user's
 * stored key, as an ambient profile, or not at all. Region is included because
 * a Bedrock API key only works where it was created, which is the most common
 * BYOK failure.
 */
export async function inferenceProbe(): Promise<InferenceCredentials> {
  return resolveInferenceCredentials(
    { get: getSecret },
    { region: (await loadConfig()).bedrockRegion },
  );
}
