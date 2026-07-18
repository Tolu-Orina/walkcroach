import { describe, expect, it, vi } from 'vitest';
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
    expect(result.status).toBe('success');
    expect(result.content).toContain('not simulated');
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
