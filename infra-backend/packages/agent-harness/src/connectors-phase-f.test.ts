import { describe, expect, it } from 'vitest';
import {
  getMcpConfigFromEnv,
  isMcpWriteTool,
  DEFAULT_MCP_URL,
} from './mcp.js';
import { workflowEmbedText } from './workflow-memory.js';
import { toBedrockTools, getToolKind } from './tools.js';

describe('Phase F connectors + MCP', () => {
  it('exposes connector and MCP tools on chat', () => {
    const names = toBedrockTools('chat').map((t) => t.toolSpec.name);
    expect(names).toContain('list_connectors');
    expect(names).toContain('propose_connector_action');
    expect(names).toContain('recall_workflow_runs');
    expect(names).toContain('cockroach_mcp');
    expect(getToolKind('propose_connector_action')).toBe('server');
  });

  it('reads MCP config from env', () => {
    expect(getMcpConfigFromEnv({})).toBeNull();
    const cfg = getMcpConfigFromEnv({
      CRDB_MCP_API_KEY: 'test-key',
      CRDB_MCP_CLUSTER_ID: 'cluster-1',
    });
    expect(cfg).toEqual({
      url: DEFAULT_MCP_URL,
      apiKey: 'test-key',
      clusterId: 'cluster-1',
    });
  });

  it('treats select_query as read and invent as write', () => {
    expect(isMcpWriteTool('select_query')).toBe(false);
    expect(isMcpWriteTool('execute_sql')).toBe(true);
  });

  it('builds workflow embed text from proposed args', () => {
    const text = workflowEmbedText({
      action: 'gmail.send',
      proposed: {
        args: {
          to: ['a@b.test'],
          subject: 'Sale this weekend',
          body: 'Come by Saturday',
        },
      },
      status: 'executed',
    });
    expect(text).toContain('gmail.send');
    expect(text).toContain('Sale this weekend');
  });
});
