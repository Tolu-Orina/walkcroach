/**
 * Optional CockroachDB Managed MCP client stub.
 * Wire service-account auth in Phase 1 when enabling agent MCP tools.
 */
export type McpConfig = {
  url: string;
  apiKey: string;
};

export function getMcpConfigFromEnv(): McpConfig | null {
  const url = process.env.CRDB_MCP_URL;
  const apiKey = process.env.CRDB_MCP_API_KEY;
  if (!url || !apiKey) return null;
  return { url, apiKey };
}
