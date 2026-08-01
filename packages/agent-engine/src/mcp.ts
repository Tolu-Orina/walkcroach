/**
 * CockroachDB Cloud Managed MCP client (FR-D11–D14).
 * Connects directly to https://cockroachlabs.cloud/mcp — no WalkCroach Lambda proxy.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  isValidMcpServerName,
  qualifyToolName,
  TOOL_NAMESPACE_SEP,
} from './mcp-stdio.js';
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

const COCKROACHDB_LABEL = 'CockroachDB MCP';

/**
 * `serverLabel` defaults to the CockroachDB label so every existing call site
 * (CockroachMcpClient) is byte-for-byte unchanged. GenericMcpClient passes its
 * own server name so generic-server errors don't misleadingly say "CockroachDB".
 */
export function plainMcpError(
  err: unknown,
  serverLabel: string = COCKROACHDB_LABEL,
): string {
  const msg = err instanceof Error ? err.message : String(err);
  const isCockroachDb = serverLabel === COCKROACHDB_LABEL;
  if (/401|unauthorized|forbidden/i.test(msg)) {
    return isCockroachDb
      ? 'CockroachDB MCP rejected credentials. Re-run “WalkCroach: Configure CockroachDB” and check the service-account API key + cluster ID.'
      : `MCP server "${serverLabel}" rejected credentials (401/403). Check the headers in .walkcroach/mcp.json.`;
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(msg)) {
    return isCockroachDb
      ? 'Could not reach the CockroachDB Managed MCP server. Check network access to cockroachlabs.cloud.'
      : `Could not reach MCP server "${serverLabel}". Check the url in .walkcroach/mcp.json.`;
  }
  if (/timeout/i.test(msg)) {
    return isCockroachDb
      ? 'CockroachDB MCP timed out. Retry the same tool call.'
      : `MCP server "${serverLabel}" timed out. Retry the same tool call.`;
  }
  return isCockroachDb
    ? `CockroachDB MCP error: ${msg}`
    : `MCP server "${serverLabel}" error: ${msg}`;
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

/** Project-configured (`.walkcroach/mcp.json`) MCP server — arbitrary headers, no CockroachDB assumptions. */
export type McpServerConfig = {
  url: string;
  headers?: Record<string, string>;
};

/** Common shape shared by CockroachMcpClient and GenericMcpClient (structural — no explicit `implements` needed). */
export type McpClientLike = {
  readonly connected: boolean;
  connect(): Promise<void>;
  listTools(): McpToolInfo[];
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
};

/**
 * Generic Streamable-HTTP MCP client for arbitrary project-configured servers
 * (`.walkcroach/mcp.json`). HTTP/Streamable only — no stdio spawning (see
 * McpServerRegistry doc comment for why that's deferred).
 */
export class GenericMcpClient implements McpClientLike {
  private client: Client | null = null;
  private tools: McpToolInfo[] = [];

  constructor(
    private readonly config: McpServerConfig,
    /** Server name from .walkcroach/mcp.json, used only for error messages. */
    private readonly serverName: string = 'MCP server',
  ) {}

  get connected(): boolean {
    return this.client !== null;
  }

  listTools(): McpToolInfo[] {
    return this.tools;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    // Unlike CockroachMcpClient's DEFAULT_MCP_URL fallback, a generic server's url is
    // user-configured (.walkcroach/mcp.json) and can be malformed — parse it inside the
    // try block so a bad URL is reported through plainMcpError, not a raw TypeError.
    let client: Client | undefined;
    try {
      const url = new URL(this.config.url);
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: this.config.headers ?? {},
        },
      });
      client = new Client({
        name: 'walkcroach-ide',
        version: '0.1.0',
      });
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
        await client?.close();
      } catch {
        // ignore
      }
      throw new Error(plainMcpError(err, this.serverName));
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (!this.client) {
      throw new Error(`MCP server "${this.serverName}" is not connected.`);
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
      throw new Error(plainMcpError(err, this.serverName));
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

/** Name reserved for the auto-registered CockroachDB client — cannot be overridden by .walkcroach/mcp.json. */
export const RESERVED_COCKROACHDB_SERVER_NAME = 'cockroachdb';

/**
 * Registry of additionally configured MCP servers (`.walkcroach/mcp.json`), separate
 * from the always-on `cockroach_mcp` tool / CockroachMcpClient.
 *
 * Holds both transports: HTTP/Streamable servers (`GenericMcpClient`) and
 * locally-spawned stdio servers (`StdioMcpClient`), which are gated by
 * `HostAdapter.isStdioMcpAllowed` and per-server consent — see `mcp-stdio.ts`
 * and `docs/walkcroach-stdio-mcp-security-review.md`.
 *
 * Every tool is addressed by (server, tool), and `listAllTools` reports the
 * qualified `server__tool` name, so no configured server can shadow a
 * first-party tool. That generalises the older `RESERVED_COCKROACHDB_SERVER_NAME`
 * protection past its single hard-coded case (T4).
 */
export class McpServerRegistry {
  private clients = new Map<string, McpClientLike>();

  /**
   * @throws if the name is unusable — reserved, or containing the `__`
   * namespace separator, which would make a qualified tool name ambiguous.
   */
  register(name: string, config: McpServerConfig): void {
    this.assertRegistrableName(name);
    this.clients.set(name, new GenericMcpClient(config, name));
  }

  /** Adopt an already-constructed client (used for supervised stdio servers). */
  adopt(name: string, client: McpClientLike): void {
    this.assertRegistrableName(name);
    this.clients.set(name, client);
  }

  private assertRegistrableName(name: string): void {
    if (name === RESERVED_COCKROACHDB_SERVER_NAME) {
      throw new Error(
        `"${name}" is reserved for the built-in CockroachDB MCP client.`,
      );
    }
    if (!isValidMcpServerName(name)) {
      throw new Error(
        `Invalid MCP server name "${name}": use letters, digits, dot, dash or underscore, and no "${TOOL_NAMESPACE_SEP}".`,
      );
    }
  }

  serverNames(): string[] {
    return [...this.clients.keys()];
  }

  isConnected(name: string): boolean {
    return this.clients.get(name)?.connected ?? false;
  }

  /** Connects every registered server; returns per-server error messages for any that failed. */
  async connectAll(): Promise<Map<string, string>> {
    const errors = new Map<string, string>();
    for (const [name, client] of this.clients) {
      try {
        await client.connect();
      } catch (err) {
        errors.set(name, err instanceof Error ? err.message : String(err));
      }
    }
    return errors;
  }

  /**
   * Every tool from every configured server.
   *
   * `qualifiedName` (`server__tool`) is what any caller surfacing these to the
   * model must use. `name` is the raw name the server reported and is only for
   * addressing `callTool`; using it in a prompt would reintroduce the shadowing
   * this scheme exists to prevent.
   */
  listAllTools(): Array<{
    server: string;
    name: string;
    qualifiedName: string;
    description?: string;
  }> {
    const out: Array<{
      server: string;
      name: string;
      qualifiedName: string;
      description?: string;
    }> = [];
    for (const [server, client] of this.clients) {
      for (const t of client.listTools()) {
        out.push({
          server,
          name: t.name,
          qualifiedName: qualifyToolName(server, t.name),
          description: t.description,
        });
      }
    }
    return out;
  }

  async callTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const client = this.clients.get(server);
    if (!client?.connected) {
      throw new Error(
        `MCP server "${server}" is not connected. Check .walkcroach/mcp.json.`,
      );
    }
    return client.callTool(tool, args);
  }

  async closeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
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
