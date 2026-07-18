/**
 * CockroachDB Cloud Managed MCP client (FR-D11–D14).
 * Connects directly to https://cockroachlabs.cloud/mcp — no WalkCroach Lambda proxy.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const DEFAULT_MCP_URL = 'https://cockroachlabs.cloud/mcp';

export type McpConfig = {
  url?: string;
  clusterId: string;
  /** Service-account API key (Bearer). Stored in SecretStorage — never in workspace files. */
  apiKey: string;
};

export type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

/** Known read-only Managed MCP tools (docs). Anything else needs write consent. */
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

const WRITE_NAME =
  /^(insert|update|delete|upsert|execute|create|drop|alter|truncate|grant|revoke|write)/i;

/** @deprecated Prefer isMcpWriteTool — kept for tests that assert write-name heuristics. */
export function looksLikeMcpWriteName(name: string): boolean {
  return WRITE_NAME.test(name);
}

export function isMcpWriteTool(name: string): boolean {
  // Strict allowlist only (FR-D12). Unknown / mutating-looking names need consent.
  if (READ_TOOL_NAMES.has(name)) return false;
  return true;
}

export function plainMcpError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|unauthorized|forbidden/i.test(msg)) {
    return 'CockroachDB MCP rejected credentials. Re-run “WalkCroach: Configure CockroachDB” and check the service-account API key + cluster ID.';
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(msg)) {
    return 'Could not reach the CockroachDB Managed MCP server. Check network access to cockroachlabs.cloud.';
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

    const url = new URL(this.config.url ?? DEFAULT_MCP_URL);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: {
          'mcp-cluster-id': this.config.clusterId,
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      },
    });

    const client = new Client({
      name: 'walkcroach-ide',
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
        // ignore
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
        'MCP is not connected. Configure CockroachDB credentials first (WalkCroach: Configure CockroachDB).',
      );
    }
    try {
      const result = await this.client.callTool({
        name,
        arguments: args,
      });
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
        // ignore
      }
      this.client = null;
      this.tools = [];
    }
  }
}

function truncateJson(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > 40_000 ? `${s.slice(0, 40_000)}\n…[truncated]` : s;
  } catch {
    return String(value);
  }
}

/** Parse Cloud Console / Cursor-style MCP snippet JSON. */
export function parseMcpConfigSnippet(raw: string): Partial<McpConfig> {
  const trimmed = raw.trim();
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    throw new Error('MCP config must be JSON (Cloud Console snippet).');
  }

  // Shapes:
  // { mcpServers: { name: { url, headers } } }
  // { url, headers }
  const root = obj as Record<string, unknown>;
  let server: Record<string, unknown> | undefined = root;

  if (root.mcpServers && typeof root.mcpServers === 'object') {
    const servers = root.mcpServers as Record<string, Record<string, unknown>>;
    const first = Object.values(servers)[0];
    server = first;
  }

  if (!server) throw new Error('No MCP server entry found in snippet.');

  const url = typeof server.url === 'string' ? server.url : undefined;
  const headers = (server.headers ?? {}) as Record<string, string>;
  const clusterId =
    headers['mcp-cluster-id'] ??
    headers['Mcp-Cluster-Id'] ??
    (typeof server.clusterId === 'string' ? server.clusterId : undefined);

  let apiKey: string | undefined;
  const auth = headers.Authorization ?? headers.authorization;
  if (typeof auth === 'string') {
    apiKey = auth.replace(/^Bearer\s+/i, '').trim();
  }

  return { url, clusterId, apiKey };
}
