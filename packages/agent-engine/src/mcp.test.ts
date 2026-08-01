import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockConnect = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();
const mockClose = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    close: mockClose,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));

import {
  GenericMcpClient,
  McpServerRegistry,
  RESERVED_COCKROACHDB_SERVER_NAME,
  plainMcpError,
} from './mcp.js';

describe('plainMcpError', () => {
  it('defaults to the CockroachDB label unchanged', () => {
    expect(plainMcpError(new Error('401 Unauthorized'))).toMatch(
      /Configure CockroachDB/i,
    );
  });

  it('uses a neutral, server-named message when given a label', () => {
    const msg = plainMcpError(new Error('401 Unauthorized'), 'github');
    expect(msg).toMatch(/github/i);
    expect(msg).not.toMatch(/CockroachDB/i);
  });

  it('labels network and timeout errors for a named server', () => {
    expect(plainMcpError(new Error('ECONNREFUSED'), 'github')).toMatch(
      /Could not reach MCP server "github"/,
    );
    expect(plainMcpError(new Error('timeout'), 'github')).toMatch(
      /MCP server "github" timed out/,
    );
    expect(plainMcpError(new Error('boom'), 'github')).toMatch(
      /MCP server "github" error: boom/,
    );
  });
});

describe('GenericMcpClient', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockListTools.mockReset();
    mockCallTool.mockReset();
    mockClose.mockReset();
  });

  it('connects and lists tools', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: [{ name: 'search_issues', description: 'Search issues' }],
    });

    const client = new GenericMcpClient(
      { url: 'https://mcp.example.com', headers: { Authorization: 'Bearer x' } },
      'github',
    );
    expect(client.connected).toBe(false);
    await client.connect();
    expect(client.connected).toBe(true);
    expect(client.listTools()).toEqual([
      { name: 'search_issues', description: 'Search issues', inputSchema: undefined },
    ]);
  });

  it('wraps connect failures with the server label and closes the half-open client', async () => {
    mockConnect.mockRejectedValue(new Error('401 Unauthorized'));
    mockClose.mockResolvedValue(undefined);

    const client = new GenericMcpClient({ url: 'https://mcp.example.com' }, 'github');
    await expect(client.connect()).rejects.toThrow(/github/);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(client.connected).toBe(false);
  });

  it('wraps a malformed URL through plainMcpError instead of a raw TypeError', async () => {
    const client = new GenericMcpClient({ url: 'not-a-valid-url' }, 'github');
    await expect(client.connect()).rejects.toThrow(/github/);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(client.connected).toBe(false);
  });

  it('callTool flattens text content blocks and errors when not connected', async () => {
    const client = new GenericMcpClient({ url: 'https://mcp.example.com' }, 'github');
    await expect(client.callTool('foo', {})).rejects.toThrow(/not connected/);

    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [] });
    await client.connect();

    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
    });
    expect(await client.callTool('foo', {})).toBe('hello');
  });

  it('close is a no-op when never connected', async () => {
    const client = new GenericMcpClient({ url: 'https://mcp.example.com' }, 'github');
    await expect(client.close()).resolves.toBeUndefined();
  });
});

describe('McpServerRegistry', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockListTools.mockReset();
    mockCallTool.mockReset();
    mockClose.mockReset();
  });

  it('connects all registered servers and reports per-server errors', async () => {
    const registry = new McpServerRegistry();
    registry.register('github', { url: 'https://gh.example.com' });
    registry.register('linear', { url: 'https://linear.example.com' });

    mockConnect
      .mockResolvedValueOnce(undefined) // github
      .mockRejectedValueOnce(new Error('ECONNREFUSED')); // linear
    mockListTools.mockResolvedValue({ tools: [] });
    mockClose.mockResolvedValue(undefined);

    const errors = await registry.connectAll();
    expect(registry.isConnected('github')).toBe(true);
    expect(registry.isConnected('linear')).toBe(false);
    expect(errors.size).toBe(1);
    expect(errors.get('linear')).toMatch(/linear/);
    expect(registry.serverNames()).toEqual(['github', 'linear']);
  });

  it('namespaces listAllTools by server', async () => {
    const registry = new McpServerRegistry();
    registry.register('github', { url: 'https://gh.example.com' });
    registry.register('linear', { url: 'https://linear.example.com' });

    mockConnect.mockResolvedValue(undefined);
    mockListTools
      .mockResolvedValueOnce({ tools: [{ name: 'search_issues' }] })
      .mockResolvedValueOnce({ tools: [{ name: 'list_teams' }] });

    await registry.connectAll();
    // `qualifiedName` is what any surface exposing these to the model must
    // use — it is what stops a configured server shadowing a first-party tool.
    expect(registry.listAllTools()).toEqual([
      {
        server: 'github',
        name: 'search_issues',
        qualifiedName: 'github__search_issues',
        description: undefined,
      },
      {
        server: 'linear',
        name: 'list_teams',
        qualifiedName: 'linear__list_teams',
        description: undefined,
      },
    ]);
  });

  it('routes callTool to the named server and errors for an unconnected one', async () => {
    const registry = new McpServerRegistry();
    registry.register('github', { url: 'https://gh.example.com' });

    await expect(registry.callTool('github', 'foo', {})).rejects.toThrow(
      /"github" is not connected/,
    );

    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [] });
    await registry.connectAll();

    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    expect(await registry.callTool('github', 'foo', {})).toBe('ok');

    await expect(registry.callTool('nonexistent', 'foo', {})).rejects.toThrow(
      /"nonexistent" is not connected/,
    );
  });

  it('closeAll closes every registered client', async () => {
    const registry = new McpServerRegistry();
    registry.register('github', { url: 'https://gh.example.com' });
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [] });
    mockClose.mockResolvedValue(undefined);
    await registry.connectAll();

    await registry.closeAll();
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(registry.isConnected('github')).toBe(false);
  });

  it('exposes the reserved CockroachDB server name for callers to skip', () => {
    expect(RESERVED_COCKROACHDB_SERVER_NAME).toBe('cockroachdb');
  });
});
