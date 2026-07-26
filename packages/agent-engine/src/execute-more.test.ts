import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEmbedText = vi.fn();
vi.mock('./bedrock.js', () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
}));

import { createFakeHost } from './fake-host.js';
import { executeTool } from './tools/execute.js';
import type { ToolExecResult } from './tools/execute.js';
import { TelemetrySink } from './telemetry.js';
import { SkillsRegistry } from './skills.js';

describe('executeTool — read_file', () => {
  it('reads an existing file', async () => {
    const host = createFakeHost({
      files: { 'src/index.ts': 'export const x = 1;\n' },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: { toolUseId: 'r1', name: 'read_file', input: { path: 'src/index.ts' } },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('export const x = 1');
  });

  it('returns error for missing file', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: { toolUseId: 'r2', name: 'read_file', input: { path: 'nope.ts' } },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('ENOENT');
  });
});

describe('executeTool — list_dir', () => {
  it('lists directory entries', async () => {
    const host = createFakeHost({
      files: {
        'src/a.ts': 'a',
        'src/b.ts': 'b',
        'README.md': 'hi',
      },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: { toolUseId: 'l1', name: 'list_dir', input: { path: '.' } },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('src');
    expect(result.content).toContain('README.md');
  });

  it('defaults to "." when path is empty', async () => {
    const host = createFakeHost({
      files: { 'foo.txt': 'bar' },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: { toolUseId: 'l2', name: 'list_dir', input: {} },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('foo.txt');
  });
});

describe('executeTool — search', () => {
  it('finds matching lines', async () => {
    const host = createFakeHost({
      files: {
        'a.ts': 'const x = 1;\nconst y = 2;\n',
        'b.ts': 'hello world\n',
      },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: { toolUseId: 's1', name: 'search', input: { pattern: 'const' } },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('const x');
    expect(result.content).toContain('const y');
  });

  it('returns no matches message', async () => {
    const host = createFakeHost({
      files: { 'a.ts': 'foo\n' },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: { toolUseId: 's2', name: 'search', input: { pattern: 'zzz_no_match' } },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('no matches');
  });
});

describe('executeTool — run_terminal exit codes', () => {
  it('captures echo output', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: { toolUseId: 't1', name: 'run_terminal', input: { cmd: 'echo hello' } },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('hello');
  });

  it('returns error status for non-simulated commands', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: { toolUseId: 't2', name: 'run_terminal', input: { cmd: 'npm test' } },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('not simulated');
  });

  it('starts background mode and returns task id', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 't3',
        name: 'run_terminal',
        input: { cmd: 'npx vite', mode: 'background' },
      },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('fake-bg');
    expect(result.content).toContain('await_terminal');
  });

  it('polls with await_terminal', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 't4',
        name: 'await_terminal',
        input: { task_id: 'fake-bg' },
      },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('status: exited');
  });
});

describe('executeTool — todo persistence', () => {
  it('persists todos via host.persistTodos', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'td1',
        name: 'todo_write',
        input: {
          todos: [
            { id: '1', content: 'Scaffold app', status: 'in_progress' },
            { id: '2', content: 'Start server', status: 'pending' },
          ],
        },
      },
    });
    expect(result.status).toBe('success');
    const loaded = await host.loadTodos?.();
    expect(loaded?.length).toBe(2);
    expect(loaded?.[0]?.content).toBe('Scaffold app');
  });
});

describe('executeTool — edit_file ambiguity', () => {
  it('rejects ambiguous edit with multiple matches', async () => {
    const host = createFakeHost({
      files: { 'a.ts': 'foo\nfoo\n' },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'e1',
        name: 'edit_file',
        input: { path: 'a.ts', old_str: 'foo', new_str: 'bar' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('matches 2 locations');
  });

  it('rejects edit_file with empty old_str', async () => {
    const host = createFakeHost({
      files: { 'a.ts': 'content' },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'e2',
        name: 'edit_file',
        input: { path: 'a.ts', old_str: '', new_str: 'bar' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('non-empty old_str');
  });

  it('rejects edit_file when old_str is not found', async () => {
    const host = createFakeHost({
      files: { 'a.ts': 'content' },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'e3',
        name: 'edit_file',
        input: { path: 'a.ts', old_str: 'not_there', new_str: 'bar' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('not found');
  });
});

describe('executeTool — readOnly rejection', () => {
  it('rejects write tools in readOnly mode', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'w1',
        name: 'write_file',
        input: { path: 'a.ts', content: 'x' },
      },
      readOnly: true,
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('not allowed in read-only');
  });

  it('rejects run_terminal in readOnly mode', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: { toolUseId: 'w2', name: 'run_terminal', input: { cmd: 'ls' } },
      readOnly: true,
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('not allowed in read-only');
  });

  it('allows read_file in readOnly mode', async () => {
    const host = createFakeHost({
      files: { 'a.ts': 'ok' },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: { toolUseId: 'r1', name: 'read_file', input: { path: 'a.ts' } },
      readOnly: true,
    });
    expect(result.status).toBe('success');
  });
});

describe('executeTool — load_skill', () => {
  it('loads a bundled skill', async () => {
    const host = createFakeHost({ autoApprove: true });
    const skills = new SkillsRegistry();
    await skills.init([]);
    const metas = skills.listMeta();
    const firstName = metas[0]!.name;

    const result = await executeTool({
      host,
      tool: { toolUseId: 'sk1', name: 'load_skill', input: { name: firstName } },
      skills,
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain(firstName);
  });

  it('errors for unknown skill', async () => {
    const host = createFakeHost({ autoApprove: true });
    const skills = new SkillsRegistry();
    await skills.init([]);

    const result = await executeTool({
      host,
      tool: { toolUseId: 'sk2', name: 'load_skill', input: { name: 'nonexistent-skill' } },
      skills,
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('Unknown skill');
  });

  it('errors when skills registry is null', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: { toolUseId: 'sk3', name: 'load_skill', input: { name: 'any' } },
      skills: null,
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('not initialized');
  });
});

describe('executeTool — load_rule', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('loads a manual rule body by name', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-load-rule-'));
    await mkdir(join(dir, '.walkcroach', 'rules'), { recursive: true });
    await writeFile(
      join(dir, '.walkcroach', 'rules', 'deploy.md'),
      [
        '---',
        'name: deploy-checklist',
        'description: Steps to run before deploying',
        '---',
        '',
        '1. Run migrations.',
      ].join('\n'),
      'utf8',
    );
    const host = createFakeHost({ autoApprove: true, workspaceRoot: dir });

    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'lr1',
        name: 'load_rule',
        input: { name: 'deploy-checklist' },
      },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('deploy-checklist');
    expect(result.content).toContain('Steps to run before deploying');
    expect(result.content).toContain('Run migrations');
  });

  it('errors for an unknown rule name', async () => {
    const dir2 = await mkdtemp(join(tmpdir(), 'wc-load-rule-'));
    dir = dir2;
    await mkdir(join(dir2, '.walkcroach', 'rules'), { recursive: true });
    const host = createFakeHost({ autoApprove: true, workspaceRoot: dir2 });

    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'lr2',
        name: 'load_rule',
        input: { name: 'nonexistent' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('Unknown project rule');
  });
});

describe('executeTool — mcp_call', () => {
  it('errors when no registry is configured', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'mc1',
        name: 'mcp_call',
        input: { server: 'github', tool: 'search_issues' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('No additional MCP servers configured');
  });

  it('errors in read-only sub-agent mode even with a registry configured', async () => {
    const host = createFakeHost({ autoApprove: true });
    const mcpServers = { callTool: vi.fn() };
    const result = await executeTool({
      host,
      readOnly: true,
      mcpServers,
      tool: {
        toolUseId: 'mc2',
        name: 'mcp_call',
        input: { server: 'github', tool: 'search_issues' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('read-only');
    expect(mcpServers.callTool).not.toHaveBeenCalled();
  });

  it('calls the registry after approval', async () => {
    const host = createFakeHost({ autoApprove: true });
    const mcpServers = {
      callTool: vi.fn().mockResolvedValue('issue #42: fix bug'),
    };
    const result = await executeTool({
      host,
      mcpServers,
      tool: {
        toolUseId: 'mc3',
        name: 'mcp_call',
        input: { server: 'github', tool: 'search_issues', arguments: { q: 'bug' } },
      },
    });
    expect(result.status).toBe('success');
    expect(result.content).toBe('issue #42: fix bug');
    expect(mcpServers.callTool).toHaveBeenCalledWith('github', 'search_issues', {
      q: 'bug',
    });
  });

  it('is rejected when the user declines the confirmation', async () => {
    const host = createFakeHost();
    const mcpServers = { callTool: vi.fn() };
    const p = executeTool({
      host,
      mcpServers,
      tool: {
        toolUseId: 'mc4',
        name: 'mcp_call',
        input: { server: 'github', tool: 'delete_issue' },
      },
    });
    await vi.waitFor(() => {
      expect(host.events.some((e) => e.type === 'approval_request')).toBe(true);
    });
    const req = host.events.find((e) => e.type === 'approval_request');
    if (req?.type === 'approval_request') {
      host.resolveApproval(req.request.stepId, 'reject');
    }
    const result = await p;
    expect(result.status).toBe('rejected');
    expect(mcpServers.callTool).not.toHaveBeenCalled();
  });
});

describe('executeTool — semantic_search', () => {
  let dir: string;

  afterEach(async () => {
    mockEmbedText.mockReset();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('ranks results using embedText and reports the workspace file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-semsearch-'));
    await writeFile(
      join(dir, 'fruit.ts'),
      'export const note = "banana fruit stand";\n',
    );
    const host = createFakeHost({ autoApprove: true, workspaceRoot: dir });
    mockEmbedText.mockImplementation(async (text: string) => [
      text.toLowerCase().includes('banana') ? 1 : 0,
    ]);

    const result = await executeTool({
      host,
      tool: {
        toolUseId: 's1',
        name: 'semantic_search',
        input: { query: 'banana' },
      },
    });

    expect(result.status).toBe('success');
    expect(result.content).toContain('fruit.ts');
  });

  it('rejects an empty query without needing a workspace', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: { toolUseId: 's2', name: 'semantic_search', input: { query: '  ' } },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('non-empty query');
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('errors when no workspace folder is open', async () => {
    const host = {
      ...createFakeHost({ autoApprove: true }),
      getWorkspaceRoot: () => undefined,
    };
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 's3',
        name: 'semantic_search',
        input: { query: 'anything' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('No workspace folder open');
  });

  it('refuses when index.enabled is false in settings', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-semsearch-'));
    const host = createFakeHost({ autoApprove: true, workspaceRoot: dir });

    const result = await executeTool({
      host,
      indexSettings: { enabled: false, maxFiles: 10 },
      tool: {
        toolUseId: 's4',
        name: 'semantic_search',
        input: { query: 'anything' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('disabled');
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('wraps an embedding failure with a clear Bedrock-credentials message', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-semsearch-'));
    await writeFile(join(dir, 'a.ts'), 'export const a = 1;\n');
    const host = createFakeHost({ autoApprove: true, workspaceRoot: dir });
    mockEmbedText.mockRejectedValue(new Error('CredentialsProviderError'));

    const result = await executeTool({
      host,
      tool: {
        toolUseId: 's5',
        name: 'semantic_search',
        input: { query: 'anything' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('Bedrock credentials');
    expect(result.content).toContain('CredentialsProviderError');
  });

  it('reports no results without erroring when the index has no matches', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-semsearch-'));
    const host = createFakeHost({ autoApprove: true, workspaceRoot: dir });
    mockEmbedText.mockResolvedValue([1, 0]);

    const result = await executeTool({
      host,
      tool: {
        toolUseId: 's6',
        name: 'semantic_search',
        input: { query: 'anything' },
      },
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('No semantically related results found');
  });
});

describe('executeTool — recall_project_memory', () => {
  it('recalls from project memory', async () => {
    const host = createFakeHost({ autoApprove: true });
    const mockBridge = {
      projectId: 'p1',
      projectName: 'Test Project',
      recall: vi.fn().mockResolvedValue([
        { id: 'h1', kind: 'decision', text: 'Use UUID PKs', sourceSurface: 'web' },
      ]),
      mirror: vi.fn(),
    };

    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'pm1',
        name: 'recall_project_memory',
        input: { query: 'primary keys' },
      },
      projectMemory: mockBridge,
      telemetry: new TelemetrySink(),
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('UUID PKs');
    expect(mockBridge.recall).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'primary keys' }),
    );
  });

  it('errors when not linked', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'pm2',
        name: 'recall_project_memory',
        input: { query: 'test' },
      },
      projectMemory: null,
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('unavailable');
  });
});

describe('executeTool — mirror_project_memory', () => {
  it('mirrors to project memory with approval', async () => {
    const host = createFakeHost({ autoApprove: true });
    const mockBridge = {
      projectId: 'p1',
      recall: vi.fn(),
      mirror: vi.fn().mockResolvedValue({ id: 'entry-1' }),
    };

    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'mm1',
        name: 'mirror_project_memory',
        input: { text: 'Prefer UUID PKs', kind: 'convention' },
      },
      projectMemory: mockBridge,
      telemetry: new TelemetrySink(),
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('Mirrored');
    expect(mockBridge.mirror).toHaveBeenCalled();
  });

  it('errors when text is empty', async () => {
    const host = createFakeHost({ autoApprove: true });
    const mockBridge = {
      projectId: 'p1',
      recall: vi.fn(),
      mirror: vi.fn(),
    };
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'mm2',
        name: 'mirror_project_memory',
        input: { text: '' },
      },
      projectMemory: mockBridge,
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('required');
  });
});

describe('executeTool — mirror_skill', () => {
  it('mirrors to the shared skill library with approval', async () => {
    const host = createFakeHost({ autoApprove: true });
    const mockBridge = {
      list: vi.fn(),
      mirror: vi.fn().mockResolvedValue({ id: 'skill-1' }),
    };

    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'ms1',
        name: 'mirror_skill',
        input: {
          name: 'my-skill',
          description: 'A useful recipe',
          body: 'Do the thing.',
        },
      },
      sharedSkills: mockBridge,
      telemetry: new TelemetrySink(),
    });
    expect(result.status).toBe('success');
    expect(result.content).toContain('Mirrored skill');
    expect(mockBridge.mirror).toHaveBeenCalledWith({
      name: 'my-skill',
      description: 'A useful recipe',
      body: 'Do the thing.',
    });
  });

  it('rejects when the user declines approval', async () => {
    const host = createFakeHost();
    const mockBridge = {
      list: vi.fn(),
      mirror: vi.fn(),
    };
    const p = executeTool({
      host,
      tool: {
        toolUseId: 'ms2',
        name: 'mirror_skill',
        input: { name: 'my-skill', description: 'desc', body: 'body' },
      },
      sharedSkills: mockBridge,
    });
    await vi.waitFor(() => {
      expect(host.events.some((e) => e.type === 'approval_request')).toBe(true);
    });
    const req = host.events.find((e) => e.type === 'approval_request');
    if (req?.type === 'approval_request') {
      host.resolveApproval(req.request.stepId, 'reject');
    }
    const result = await p;
    expect(result.status).toBe('rejected');
    expect(mockBridge.mirror).not.toHaveBeenCalled();
  });

  it('errors when sharedSkills bridge is unavailable', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'ms3',
        name: 'mirror_skill',
        input: { name: 'my-skill', description: 'desc', body: 'body' },
      },
      sharedSkills: null,
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('unavailable');
  });

  it('errors when name is empty', async () => {
    const host = createFakeHost({ autoApprove: true });
    const mockBridge = { list: vi.fn(), mirror: vi.fn() };
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'ms4',
        name: 'mirror_skill',
        input: { name: '', description: 'desc', body: 'body' },
      },
      sharedSkills: mockBridge,
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('required');
  });
});

describe('executeTool — unknown tool', () => {
  it('errors for unrecognized tool name', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: { toolUseId: 'u1', name: 'unknown_tool', input: {} },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('Unknown tool');
  });
});

describe('executeTool — abort signal', () => {
  it('errors immediately when signal is already aborted', async () => {
    const host = createFakeHost({ autoApprove: true });
    const ac = new AbortController();
    ac.abort();
    await expect(
      executeTool({
        host,
        tool: { toolUseId: 'a1', name: 'read_file', input: { path: 'a.ts' } },
        signal: ac.signal,
      }),
    ).rejects.toThrow(/Aborted/);
  });
});

describe('executeTool — checkpoint recording (P2)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function readCheckpointLines(turnId: string): Promise<unknown[]> {
    const { readFile } = await import('node:fs/promises');
    const { CHECKPOINTS_REL_DIR } = await import('./checkpoints.js');
    const raw = await readFile(
      join(dir, CHECKPOINTS_REL_DIR, `${turnId}.jsonl`),
      'utf8',
    );
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  it('write_file with a turnId records a created-file checkpoint', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-ckpt-exec-'));
    const host = createFakeHost({ autoApprove: true, workspaceRoot: dir });

    await executeTool({
      host,
      turnId: 'turn-1',
      tool: {
        toolUseId: 'w1',
        name: 'write_file',
        input: { path: 'new.ts', content: 'export const x = 1;\n' },
      },
    });

    const entries = await readCheckpointLines('turn-1');
    expect(entries).toEqual([
      expect.objectContaining({
        toolUseId: 'w1',
        path: 'new.ts',
        before: '',
        beforeExisted: false,
        after: 'export const x = 1;\n',
      }),
    ]);
  });

  it('edit_file with a turnId records beforeExisted: true', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-ckpt-exec-'));
    const host = createFakeHost({
      autoApprove: true,
      workspaceRoot: dir,
      files: { 'a.ts': 'export const a = 1;\n' },
    });

    await executeTool({
      host,
      turnId: 'turn-2',
      tool: {
        toolUseId: 'e1',
        name: 'edit_file',
        input: { path: 'a.ts', old_str: 'a = 1', new_str: 'a = 2' },
      },
    });

    const entries = await readCheckpointLines('turn-2');
    expect(entries).toEqual([
      expect.objectContaining({
        toolUseId: 'e1',
        path: 'a.ts',
        before: 'export const a = 1;\n',
        beforeExisted: true,
        after: 'export const a = 2;\n',
      }),
    ]);
  });

  it('update_walkcroach_md with a turnId records the prior content', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-ckpt-exec-'));
    const host = createFakeHost({
      autoApprove: true,
      workspaceRoot: dir,
      files: { 'WALKCROACH.md': '# WALKCROACH.md\n\nOld decision.\n' },
    });

    await executeTool({
      host,
      turnId: 'turn-3',
      tool: {
        toolUseId: 'm1',
        name: 'update_walkcroach_md',
        input: { append_section: '## New decision\n\nUse port 8080.\n' },
      },
    });

    const entries = await readCheckpointLines('turn-3');
    expect(entries).toEqual([
      expect.objectContaining({
        toolUseId: 'm1',
        path: 'WALKCROACH.md',
        before: '# WALKCROACH.md\n\nOld decision.\n',
        beforeExisted: true,
      }),
    ]);
  });

  it('does not record a checkpoint when no turnId is provided', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-ckpt-exec-'));
    const host = createFakeHost({ autoApprove: true, workspaceRoot: dir });

    await executeTool({
      host,
      tool: {
        toolUseId: 'w2',
        name: 'write_file',
        input: { path: 'new.ts', content: 'x' },
      },
    });

    const { CHECKPOINTS_REL_DIR } = await import('./checkpoints.js');
    await expect(
      readdir(join(dir, CHECKPOINTS_REL_DIR)),
    ).rejects.toThrow();
  });
});
