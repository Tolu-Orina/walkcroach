/**
 * BYOK inference credentials — Part 1 §4A / IDE §7C / CLI §6D.
 *
 * The commercial decision behind this file: the IDE and CLI are free and call
 * Bedrock **directly from the user's machine with the user's own credentials**,
 * while memory sync, MCP, ccloud and shared skills continue to go through
 * WalkCroach's authenticated backend. Inference is BYOK and direct; platform
 * features are centralised. Without this split WalkCroach pays for every
 * IDE/CLI user's inference.
 *
 * ## Why it lives in the engine
 *
 * The IDE already had a working version of this privately in
 * `webviewProvider.ts`; the CLI had none, so `walkcroach secrets set
 * bedrock.apiKey` stored a key that nothing ever read. Both hosts share this
 * engine, so the resolution rule belongs here once rather than in each host —
 * that is the whole reason `HostAdapter` exists.
 *
 * ## How the key reaches the SDK
 *
 * A Bedrock API key authenticates as a bearer token, which the AWS SDK picks
 * up from `AWS_BEARER_TOKEN_BEDROCK` rather than from client options (passing
 * it as a Smithy `token` selects a different auth scheme and fails). So the
 * key is placed in the environment for the duration of a run and removed
 * afterwards.
 *
 * Mutating `process.env` is process-global, so overlapping runs could restore
 * each other's values. `withInferenceCredentials` serialises on a promise
 * chain to make that impossible — the IDE's original version did not, and a
 * user with two panels open could have had one run clear the other's key.
 */
import type { HostSecrets } from './host.js';
import { SECRET_KEYS } from './secrets.js';
import { getBedrockRegion, normalizeBedrockApiKey } from './bedrock.js';

/** Where the credentials for a run came from. */
export type InferenceCredentialSource =
  /** A Bedrock API key the user stored with WalkCroach (BYOK). */
  | 'byok-key'
  /** `AWS_BEARER_TOKEN_BEDROCK` already in the environment. */
  | 'ambient-bearer'
  /** An AWS profile / access key / role from the standard credential chain. */
  | 'ambient-aws'
  /** Nothing found — a run would fail, and the host should say so first. */
  | 'none';

export type InferenceCredentials = {
  source: InferenceCredentialSource;
  region: string;
  /** True when a run can proceed at all. */
  configured: boolean;
};

export const ENV_BEDROCK_BEARER = 'AWS_BEARER_TOKEN_BEDROCK';

/**
 * Report which credentials a run would use, without starting one.
 *
 * Order is deliberate: a key the user explicitly gave WalkCroach wins over
 * whatever happens to be in the environment. Someone who pastes a key into
 * Setup expects that key to be used, not a stale `AWS_PROFILE` they forgot
 * about — and a silently-preferred ambient credential is the kind of thing
 * that bills the wrong AWS account.
 */
export async function resolveInferenceCredentials(
  secrets: Pick<HostSecrets, 'get'>,
  opts?: { region?: string; env?: NodeJS.ProcessEnv },
): Promise<InferenceCredentials> {
  const env = opts?.env ?? process.env;
  const region = getBedrockRegion(opts?.region);

  const stored = (await secrets.get(SECRET_KEYS.bedrockApiKey))?.trim();
  if (stored) return { source: 'byok-key', region, configured: true };

  if (env[ENV_BEDROCK_BEARER]?.trim()) {
    return { source: 'ambient-bearer', region, configured: true };
  }
  // Any of these means the standard AWS chain has something to offer. IMDS and
  // SSO caches cannot be detected without a network call, so this is a useful
  // signal rather than a guarantee — which is why it is reported, not enforced.
  if (
    env.AWS_ACCESS_KEY_ID?.trim() ||
    env.AWS_PROFILE?.trim() ||
    env.AWS_ROLE_ARN?.trim() ||
    env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim()
  ) {
    return { source: 'ambient-aws', region, configured: true };
  }

  return { source: 'none', region, configured: false };
}

/** Human-readable guidance for a host to show when nothing is configured. */
export function describeMissingCredentials(surface: 'ide' | 'cli'): string {
  const how =
    surface === 'cli'
      ? 'Run: walkcroach secrets set bedrock.apiKey'
      : 'Open WalkCroach Setup and paste a Bedrock API key';
  return (
    'No inference credentials found. WalkCroach calls Bedrock with your own AWS ' +
    `credentials, so nothing runs until one is configured.\n${how}, ` +
    'or configure the AWS CLI (AWS_PROFILE / aws configure) on this machine.'
  );
}

/**
 * Serialises env mutation. Concurrent runs would otherwise interleave their
 * save/restore and leave the wrong key — or no key — behind.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` with the user's stored Bedrock key visible to the AWS SDK.
 *
 * A no-op when no key is stored: the ambient credential chain is then used
 * exactly as before, which is what keeps this additive for anyone already
 * relying on an AWS profile.
 */
export async function withInferenceCredentials<T>(
  secrets: Pick<HostSecrets, 'get'>,
  fn: () => Promise<T>,
  opts?: { env?: NodeJS.ProcessEnv },
): Promise<T> {
  const env = opts?.env ?? process.env;
  const run = queue.then(async () => {
    const stored = (await secrets.get(SECRET_KEYS.bedrockApiKey))?.trim();
    const normalized = stored ? normalizeBedrockApiKey(stored) : '';
    if (!normalized) return fn();

    const had = Object.prototype.hasOwnProperty.call(env, ENV_BEDROCK_BEARER);
    const previous = env[ENV_BEDROCK_BEARER];
    env[ENV_BEDROCK_BEARER] = normalized;
    try {
      return await fn();
    } finally {
      // Restore precisely: deleting a variable that existed as an empty string
      // is not the same as putting the empty string back.
      if (had) env[ENV_BEDROCK_BEARER] = previous as string;
      else delete env[ENV_BEDROCK_BEARER];
    }
  });
  // Keep the chain alive even if this run rejects, or one failure would wedge
  // every later run behind a rejected promise.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}
