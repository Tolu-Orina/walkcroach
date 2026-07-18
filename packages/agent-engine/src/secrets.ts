/** SecretStorage / env key names for Phase B–C (NFR-D04 / NFR-D05). */
export const SECRET_KEYS = {
  mcpUrl: 'walkcroach.mcp.url',
  mcpClusterId: 'walkcroach.mcp.clusterId',
  mcpApiKey: 'walkcroach.mcp.apiKey',
  ccloudApiKey: 'walkcroach.ccloud.apiKey',
  /** Cognito access token (PKCE or pasted). */
  cognitoAccessToken: 'walkcroach.auth.accessToken',
  cognitoRefreshToken: 'walkcroach.auth.refreshToken',
  cognitoIdToken: 'walkcroach.auth.idToken',
  cognitoExpiresAt: 'walkcroach.auth.expiresAt',
  /** Ephemeral PKCE pending state (survives extension host restart). */
  pendingPkce: 'walkcroach.auth.pendingPkce',
} as const;

export async function loadMcpConfigFromSecrets(
  get: (key: string) => Promise<string | undefined>,
): Promise<{
  url?: string;
  clusterId: string;
  apiKey: string;
} | null> {
  const clusterId = await get(SECRET_KEYS.mcpClusterId);
  const apiKey = await get(SECRET_KEYS.mcpApiKey);
  if (!clusterId || !apiKey) return null;
  const url = (await get(SECRET_KEYS.mcpUrl)) || undefined;
  return { url, clusterId, apiKey };
}
