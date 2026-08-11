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
