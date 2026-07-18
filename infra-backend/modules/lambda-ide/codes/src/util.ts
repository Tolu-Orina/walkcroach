export function parseJsonBody<T>(raw: string | undefined):
  | { ok: true; data: T }
  | { ok: false; error: string } {
  if (!raw?.trim()) return { ok: true, data: {} as T };
  try {
    return { ok: true, data: JSON.parse(raw) as T };
  } catch {
    return { ok: false, error: 'invalid JSON body' };
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): boolean {
  return Boolean(value && UUID_RE.test(value));
}
