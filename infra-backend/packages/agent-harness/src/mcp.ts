/**
 * CockroachDB Cloud Managed MCP client for Web agent-harness (Phase F1).
 * Port of packages/agent-engine/src/mcp.ts — Streamable HTTP + Bearer.
 * Connects to https://cockroachlabs.cloud/mcp when CRDB_MCP_* env is set.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const DEFAULT_MCP_URL = 'https://cockroachlabs.cloud/mcp';

export type McpConfig = {
  url: string;
  apiKey: string;
  /** Optional; sent as mcp-cluster-id when present. */
  clusterId?: string;
};

export type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

const READ_TOOL_NAMES = new Set([
  'list_clusters',
  'get_cluster',
  'list_databases',
  'list_tables',
  'get_table_schema',
  'select_query',
  'explain_query',
  'show_running_queries',
]);

export function getMcpConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): McpConfig | null {
  const apiKey = (env.CRDB_MCP_API_KEY ?? '').trim();
  if (!apiKey) return null;
  const url = (env.CRDB_MCP_URL ?? DEFAULT_MCP_URL).trim() || DEFAULT_MCP_URL;
  const clusterId = (env.CRDB_MCP_CLUSTER_ID ?? '').trim() || undefined;
  return { url, apiKey, clusterId };
}

export function isMcpWriteTool(name: string): boolean {
  if (READ_TOOL_NAMES.has(name)) return false;
  return true;
}

export function plainMcpError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|unauthorized|forbidden/i.test(msg)) {
    return 'CockroachDB MCP rejected credentials. Check CRDB_MCP_API_KEY / cluster id.';
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(msg)) {
    return 'Could not reach the CockroachDB Managed MCP server.';
  }
  if (/timeout/i.test(msg)) {
    return 'CockroachDB MCP timed out. Retry the same tool call.';
  }
  return `CockroachDB MCP error: ${msg}`;
}

export class CockroachMcpClient {
  private client: Client | null = null;
  private tools: McpToolInfo[] = [];

  constructor(private readonly config: McpConfig) {}

  get connected(): boolean {
    return this.client !== null;
  }

  listTools(): McpToolInfo[] {
    return this.tools;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    const url = new URL(this.config.url);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
    };
    if (this.config.clusterId) {
      headers['mcp-cluster-id'] = this.config.clusterId;
    }

    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    });

    const client = new Client({
      name: 'walkcroach-web',
      version: '0.1.0',
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      this.tools = (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));
      this.client = client;
    } catch (err) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      throw new Error(plainMcpError(err));
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (!this.client) {
      throw new Error(
        'MCP is not connected. Set CRDB_MCP_API_KEY (and optional CRDB_MCP_CLUSTER_ID).',
      );
    }
    try {
      const result = await this.client.callTool({ name, arguments: args });
      const content = result.content;
      if (!Array.isArray(content)) {
        return truncateJson(result);
      }
      const text = content
        .map((block) => {
          if (
            block &&
            typeof block === 'object' &&
            'type' in block &&
            (block as { type: string }).type === 'text' &&
            'text' in block
          ) {
            return String((block as { text: string }).text);
          }
          return truncateJson(block);
        })
        .join('\n');
      return text || '(empty MCP result)';
    } catch (err) {
      throw new Error(plainMcpError(err));
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        /* ignore */
      }
      this.client = null;
      this.tools = [];
    }
  }
}

/** Cached per Lambda warm container when MCP is configured. */
let sharedClient: CockroachMcpClient | null = null;

export async function getSharedMcpClient(): Promise<CockroachMcpClient | null> {
  const cfg = getMcpConfigFromEnv();
  if (!cfg) return null;
  if (!sharedClient) {
    sharedClient = new CockroachMcpClient(cfg);
  }
  if (!sharedClient.connected) {
    await sharedClient.connect();
  }
  return sharedClient;
}

function truncateJson(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > 40_000 ? `${s.slice(0, 40_000)}\n…[truncated]` : s;
  } catch {
    return String(value);
  }
}
