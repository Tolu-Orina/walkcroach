import { describe, expect, it, vi } from 'vitest';
import { TokenDeltaCoalescer } from './coalesce.js';
import {
  parseWebviewToHostMessage,
  WEBVIEW_TO_HOST,
  HOST_TO_WEBVIEW,
} from './protocol.js';
import { runAgentLoop } from './loop.js';
import type { HostAdapter } from './host.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shouldAutoApprove,
  isInfraCommand,
  isLowFrictionEditEligible,
  canNonInteractiveApprove,
} from './approvals.js';
import { truncateText } from './truncate.js';
import { assembleSystemBlocks, buildUserTurn } from './prompt.js';
import { createFakeHost } from './fake-host.js';
import { executeTool } from './tools/execute.js';
import { mergeWalkcroachAppend } from './memory-local.js';

describe('protocol allowlist', () => {
  it('exposes closed webview→host types', () => {
    expect(WEBVIEW_TO_HOST).toEqual([
      'READY',
      'SUBMIT_TASK',
      'APPROVE_STEP',
      'REJECT_STEP',
      'SET_AUTONOMY',
      'CANCEL',
    ]);
  });

  it('includes Phase A host→webview approval + cache types', () => {
    expect(HOST_TO_WEBVIEW).toContain('APPROVAL_REQUEST');
    expect(HOST_TO_WEBVIEW).toContain('CACHE_USAGE');
  });

  it('parses valid SUBMIT_TASK', () => {
    expect(
      parseWebviewToHostMessage({ type: 'SUBMIT_TASK', text: 'ping' }),
    ).toEqual({ type: 'SUBMIT_TASK', text: 'ping' });
  });

  it('rejects unknown types', () => {
    expect(parseWebviewToHostMessage({ type: 'EVAL', code: '1+1' })).toBeNull();
    expect(
      parseWebviewToHostMessage({ type: 'TOKEN_DELTA', text: 'x' }),
    ).toBeNull();
  });

  it('rejects malformed SUBMIT_TASK', () => {
    expect(parseWebviewToHostMessage({ type: 'SUBMIT_TASK' })).toBeNull();
    expect(
      parseWebviewToHostMessage({ type: 'SUBMIT_TASK', text: 42 }),
    ).toBeNull();
  });
});

describe('TokenDeltaCoalescer', () => {
  it('batches deltas within the flush interval', async () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const c = new TokenDeltaCoalescer(flush, 16);
    c.push('a');
    c.push('b');
    c.push('c');
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('abc');
    c.dispose();
    vi.useRealTimers();
  });

  it('flushNow drains immediately before non-token events', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const c = new TokenDeltaCoalescer(flush, 16);
    c.push('hello');
    c.flushNow();
    expect(flush).toHaveBeenCalledWith('hello');
    c.push('x');
    c.dispose();
    expect(flush).toHaveBeenCalledWith('x');
    vi.useRealTimers();
  });
});

describe('approvals', () => {
  it('never auto-approves terminal or infra', () => {
    expect(isInfraCommand('ccloud cluster create')).toBe(true);
    expect(
      shouldAutoApprove({
        autonomy: 'low_friction',
        toolName: 'run_terminal',
        input: { cmd: 'npm test' },
      }),
    ).toBe(false);
  });

  it('auto-approves only narrow edit_file in low_friction', () => {
    expect(
      isLowFrictionEditEligible({
        path: 'src/a.ts',
        old_str: 'foo',
        new_str: 'bar',
      }),
    ).toBe(true);
    expect(
      shouldAutoApprove({
        autonomy: 'low_friction',
        toolName: 'edit_file',
        input: { path: 'src/a.ts', old_str: 'foo', new_str: 'bar' },
      }),
    ).toBe(true);
    expect(
      shouldAutoApprove({
        autonomy: 'strict',
        toolName: 'edit_file',
        input: { path: 'src/a.ts', old_str: 'foo', new_str: 'bar' },
      }),
    ).toBe(false);
    expect(
      shouldAutoApprove({
        autonomy: 'low_friction',
        toolName: 'write_file',
        input: { path: 'src/a.ts', content: 'x' },
      }),
    ).toBe(false);
  });

  it('non-interactive (FR-D25) never auto-approves ccloud/infra', () => {
    expect(
      canNonInteractiveApprove({
        toolName: 'ccloud',
        input: {},
        cmdPreview: 'ccloud cluster create',
      }),
    ).toBe(false);
    expect(
      canNonInteractiveApprove({
        toolName: 'edit_file',
        input: { path: 'src/a.ts', old_str: 'a', new_str: 'b' },
      }),
    ).toBe(true);
    expect(
      canNonInteractiveApprove({
        toolName: 'run_terminal',
        input: { cmd: 'npm test' },
        cmdPreview: 'npm test',
      }),
    ).toBe(false);
  });
});

describe('truncate + prompt cache order', () => {
  it('truncates long tool results', () => {
    const long = 'a'.repeat(50_000);
    const { text, truncated } = truncateText(long, 1000);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThan(1100);
    expect(text).toContain('truncated');
  });

  it('puts system text before cachePoint', () => {
    const blocks = assembleSystemBlocks({
      walkcroachMd: '# rules\nuse typescript',
    });
    expect(blocks[0]).toHaveProperty('text');
    expect(blocks[1]).toEqual({ cachePoint: { type: 'default' } });
    expect(JSON.stringify(blocks)).toContain('WALKCROACH.md');
  });

  it('builds user turn with task first', () => {
    const t = buildUserTurn({
      prompt: 'add health route',
      gitStatus: '## main',
      workspaceRoot: '/repo',
    });
    expect(t.startsWith('# Task')).toBe(true);
    expect(t).toContain('add health route');
  });
});

describe('fake host tool execution', () => {
  it('writes file after approval', async () => {
    const host = createFakeHost({
      files: { 'src/app.ts': 'export const x = 1;\n' },
      autoApprove: true,
    });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 't1',
        name: 'write_file',
        input: {
          path: 'src/health.ts',
          content: 'export function health() { return "ok"; }\n',
        },
      },
    });
    expect(result.status).toBe('success');
    expect(host.files.get('src/health.ts')).toContain('health');
  });

  it('edits file and updates WALKCROACH.md', async () => {
    const host = createFakeHost({
      files: {
        'src/app.ts': 'const port = 3000;\n',
        'WALKCROACH.md': '# WALKCROACH.md\n\n',
      },
      autoApprove: true,
    });
    const edit = await executeTool({
      host,
      tool: {
        toolUseId: 'e1',
        name: 'edit_file',
        input: {
          path: 'src/app.ts',
          old_str: '3000',
          new_str: '8080',
        },
      },
    });
    expect(edit.status).toBe('success');
    expect(host.files.get('src/app.ts')).toContain('8080');

    const md = await executeTool({
      host,
      tool: {
        toolUseId: 'm1',
        name: 'update_walkcroach_md',
        input: { append_section: '## Decision\n\nUse port 8080.\n' },
      },
    });
    expect(md.status).toBe('success');
    expect(host.files.get('WALKCROACH.md')).toContain('port 8080');
  });

  it('rejects write when user rejects', async () => {
    const host = createFakeHost({ files: {} });
    const p = executeTool({
      host,
      tool: {
        toolUseId: 't2',
        name: 'write_file',
        input: { path: 'a.ts', content: 'x' },
      },
    });
    // Wait for approval_request then reject
    await vi.waitFor(() => {
      expect(
        host.events.some((e) => e.type === 'approval_request'),
      ).toBe(true);
    });
    const req = host.events.find((e) => e.type === 'approval_request');
    if (req?.type === 'approval_request') {
      host.resolveApproval(req.request.stepId, 'reject');
    }
    const result = await p;
    expect(result.status).toBe('rejected');
    expect(host.files.has('a.ts')).toBe(false);
  });
});

describe('memory-local', () => {
  it('appends sections', () => {
    const next = mergeWalkcroachAppend('# WALKCROACH.md\n', '## A\n\nhi');
    expect(next).toContain('## A');
    expect(next).toContain('hi');
  });
});

describe('runAgentLoop trust gate', () => {
  it('throws when workspace is untrusted', async () => {
    const host: HostAdapter = {
      readFile: async () => '',
      writeFile: async () => undefined,
      listDir: async () => [],
      search: async () => [],
      runTerminal: async function* () {},
      showDiffPreview: async () => 'reject',
      confirmCommand: async () => 'reject',
      resolveApproval: () => undefined,
      getAutonomy: () => 'strict',
      setAutonomy: () => undefined,
      getWorkspaceRoot: () => '/tmp',
      isTrustedWorkspace: () => false,
      secrets: {
        get: async () => undefined,
        store: async () => undefined,
      },
      emit: () => undefined,
    };

    await expect(
      runAgentLoop({ host, prompt: 'ping' }),
    ).rejects.toThrow(/not trusted/i);
  });
});

describe('engine purity', () => {
  it('does not import vscode from any source file', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files: string[] = [];

    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (
        /from\s+['"]vscode['"]/.test(src) ||
        /require\s*\(\s*['"]vscode['"]\s*\)/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
