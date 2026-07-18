/** Max page extract chars sent to Bedrock (plan §7). */
export const MAX_EXTRACT_CHARS = 24_000;

export function truncateExtract(text: string, max = MAX_EXTRACT_CHARS): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

export function parseJsonBody<T>(raw: string | undefined): T | { error: string } {
  if (!raw?.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return { error: 'invalid JSON body' };
  }
}

/** Map Lambda TF env names onto agent-harness Bedrock helpers. */
export function bridgeBedrockEnv(): void {
  if (process.env.NOVA_MODEL_ID && !process.env.BEDROCK_NOVA_MODEL_ID) {
    process.env.BEDROCK_NOVA_MODEL_ID = process.env.NOVA_MODEL_ID;
  }
  if (
    process.env.TITAN_EMBED_MODEL_ID &&
    !process.env.BEDROCK_TITAN_EMBED_MODEL_ID
  ) {
    process.env.BEDROCK_TITAN_EMBED_MODEL_ID = process.env.TITAN_EMBED_MODEL_ID;
  }
}

export function metricLog(
  name: string,
  fields: Record<string, string | number | boolean | undefined>,
): void {
  const safe: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) safe[k] = v;
  }
  console.log(JSON.stringify({ metric: name, ...safe }));
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Simple in-process rate limit (per Lambda instance). Returns an error
 * message when exceeded, otherwise null. Caps anon/device Bedrock abuse.
 */
export function assertRateLimit(
  key: string,
  max: number,
  windowMs: number,
): string | null {
  const now = Date.now();
  const cur = rateBuckets.get(key);
  if (!cur || cur.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (cur.count >= max) {
    metricLog('chrome.rate_limit', { key: key.split(':')[0] ?? key });
    return 'rate limit exceeded — try again shortly';
  }
  cur.count += 1;
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): boolean {
  return Boolean(value && UUID_RE.test(value));
}
