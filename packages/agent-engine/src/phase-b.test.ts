import { describe, expect, it } from 'vitest';
import { isMcpWriteTool, parseMcpConfigSnippet, plainMcpError } from './mcp.js';
import { ensureJsonOutput, isCcloudInfraAction, plainCcloudError } from './ccloud.js';
import { parseSkillMd, SkillsRegistry } from './skills.js';
import { shouldAutoApprove } from './approvals.js';
import { loadMcpConfigFromSecrets, SECRET_KEYS } from './secrets.js';
import { HOST_TO_WEBVIEW } from './protocol.js';

describe('Phase B protocol', () => {
  it('includes TELEMETRY and WARNING in host→webview allowlist', () => {
    expect(HOST_TO_WEBVIEW).toContain('TELEMETRY');
    expect(HOST_TO_WEBVIEW).toContain('WARNING');
  });
});

describe('isMcpWriteTool', () => {
  it('treats known reads as non-write', () => {
    expect(isMcpWriteTool('list_tables')).toBe(false);
    expect(isMcpWriteTool('select_query')).toBe(false);
    expect(isMcpWriteTool('explain_query')).toBe(false);
    expect(isMcpWriteTool('get_table_schema')).toBe(false);
  });

  it('flags write-like and unknown tools', () => {
    expect(isMcpWriteTool('insert_row')).toBe(true);
    expect(isMcpWriteTool('execute_sql')).toBe(true);
    expect(isMcpWriteTool('mystery_op')).toBe(true);
  });

  it('treats unknown list_/get_/show_ names as write (strict allowlist)', () => {
    expect(isMcpWriteTool('list_widgets')).toBe(true);
    expect(isMcpWriteTool('get_widget')).toBe(true);
    expect(isMcpWriteTool('show_stats')).toBe(true);
  });
});

describe('parseMcpConfigSnippet', () => {
  it('parses mcpServers console shape', () => {
    const raw = JSON.stringify({
      mcpServers: {
        cockroach: {
          url: 'https://cockroachlabs.cloud/mcp',
          headers: {
            'mcp-cluster-id': 'cluster-abc',
            Authorization: 'Bearer sk-test-key',
          },
        },
      },
    });
    expect(parseMcpConfigSnippet(raw)).toEqual({
      url: 'https://cockroachlabs.cloud/mcp',
      clusterId: 'cluster-abc',
      apiKey: 'sk-test-key',
    });
  });

  it('parses flat url/headers shape', () => {
    const raw = JSON.stringify({
      url: 'https://example/mcp',
      headers: {
        'mcp-cluster-id': 'c1',
        authorization: 'Bearer key2',
      },
    });
    expect(parseMcpConfigSnippet(raw)).toEqual({
      url: 'https://example/mcp',
      clusterId: 'c1',
      apiKey: 'key2',
    });
  });

  it('rejects non-JSON', () => {
    expect(() => parseMcpConfigSnippet('not json')).toThrow(/JSON/i);
  });
});

describe('ensureJsonOutput + ccloud heuristics', () => {
  it('appends -o json when missing', () => {
    expect(ensureJsonOutput(['cluster', 'list'])).toEqual([
      'cluster',
      'list',
      '-o',
      'json',
    ]);
  });

  it('forces -o json (strips prior -o/--output)', () => {
    expect(ensureJsonOutput(['cluster', 'list', '-o', 'table'])).toEqual([
      'cluster',
      'list',
      '-o',
      'json',
    ]);
    expect(ensureJsonOutput(['--output=json', 'cluster', 'list'])).toEqual([
      'cluster',
      'list',
      '-o',
      'json',
    ]);
  });

  it('detects infra-ish actions', () => {
    expect(isCcloudInfraAction(['cluster', 'create'])).toBe(true);
    expect(isCcloudInfraAction(['cluster', 'list'])).toBe(false);
  });

  it('maps missing binary to plain error', () => {
    expect(
      plainCcloudError(new Error("spawn ccloud ENOENT")),
    ).toMatch(/not found on PATH/i);
  });
});

describe('skills', () => {
  it('parses frontmatter', () => {
    const raw = `---
name: crdb-indexes
description: Index guidance
---
# Body

Use covering indexes.
`;
    const parsed = parseSkillMd(raw);
    expect(parsed.name).toBe('crdb-indexes');
    expect(parsed.description).toBe('Index guidance');
    expect(parsed.body).toContain('covering indexes');
  });

  it('loads bundled skills progressively', async () => {
    const reg = new SkillsRegistry();
    await reg.init([]);
    const metas = reg.listMeta();
    expect(metas.length).toBeGreaterThanOrEqual(3);
    expect(reg.catalogText()).toContain(metas[0]!.name);
    const full = reg.load(metas[0]!.name);
    expect(full?.body.length).toBeGreaterThan(20);
  });
});

describe('Phase B approvals never auto', () => {
  it('never auto-approves ccloud or cockroach_mcp', () => {
    expect(
      shouldAutoApprove({
        autonomy: 'low_friction',
        toolName: 'ccloud',
        input: { args: ['cluster', 'list'] },
      }),
    ).toBe(false);
    expect(
      shouldAutoApprove({
        autonomy: 'low_friction',
        toolName: 'cockroach_mcp',
        input: { tool: 'select_query', args: {} },
      }),
    ).toBe(false);
  });
});

describe('secrets helper', () => {
  it('loads MCP config when cluster + key present', async () => {
    const store: Record<string, string> = {
      [SECRET_KEYS.mcpClusterId]: 'cid',
      [SECRET_KEYS.mcpApiKey]: 'key',
      [SECRET_KEYS.mcpUrl]: 'https://example/mcp',
    };
    const cfg = await loadMcpConfigFromSecrets(async (k) => store[k]);
    expect(cfg).toEqual({
      url: 'https://example/mcp',
      clusterId: 'cid',
      apiKey: 'key',
    });
  });

  it('returns null when incomplete', async () => {
    const cfg = await loadMcpConfigFromSecrets(async () => undefined);
    expect(cfg).toBeNull();
  });
});

describe('plain MCP errors', () => {
  it('rewrites auth failures', () => {
    expect(plainMcpError(new Error('401 Unauthorized'))).toMatch(
      /Configure CockroachDB/i,
    );
  });
});
