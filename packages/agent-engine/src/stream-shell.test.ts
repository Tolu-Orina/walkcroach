import { describe, expect, it } from 'vitest';
import {
  buildStdinPayload,
  MAX_STDIN_CHARS,
  MAX_STDIN_REPLIES,
  streamShellCommand,
} from './stream-shell.js';
import { createFakeHost } from './fake-host.js';
import { executeTool } from './tools/execute.js';
import { AGENT_SYSTEM_PROMPT } from './prompt.js';

describe('buildStdinPayload', () => {
  it('returns undefined when empty', () => {
    expect(buildStdinPayload({})).toBeUndefined();
    expect(buildStdinPayload({ stdin: '', replies: [] })).toBeUndefined();
  });

  it('keeps stdin exact (no auto newline)', () => {
    expect(buildStdinPayload({ stdin: 'y' })).toBe('y');
    expect(buildStdinPayload({ stdin: 'y\n' })).toBe('y\n');
  });

  it('appends newline to each reply when missing', () => {
    expect(buildStdinPayload({ replies: ['y', 'n\n'] })).toBe('y\nn\n');
  });

  it('concatenates stdin then replies', () => {
    expect(
      buildStdinPayload({ stdin: 'header\n', replies: ['y'] }),
    ).toBe('header\ny\n');
  });

  it('rejects oversized payloads and reply count', () => {
    expect(() =>
      buildStdinPayload({ stdin: 'x'.repeat(MAX_STDIN_CHARS + 1) }),
    ).toThrow(/exceed/);
    expect(() =>
      buildStdinPayload({
        replies: Array.from({ length: MAX_STDIN_REPLIES + 1 }, () => 'y'),
      }),
    ).toThrow(/at most/);
  });
});

describe('streamShellCommand — stdin preload', () => {
  it('feeds replies into a process that reads stdin', async () => {
    // Cross-platform: node reads one line and prints it.
    const cmd =
      'node -e "let s=\'\';process.stdin.on(\'data\',d=>s+=d);process.stdin.on(\'end\',()=>{process.stdout.write(JSON.stringify(s));process.exit(0);})"';
    let out = '';
    let code: number | null | undefined;
    for await (const chunk of streamShellCommand(cmd, {
      cwd: process.cwd(),
      replies: ['yes', 'no'],
      timeoutMs: 15_000,
    })) {
      out += chunk.text;
      if (chunk.exitCode !== undefined) code = chunk.exitCode;
    }
    expect(code).toBe(0);
    expect(out).toContain('yes');
    expect(out).toContain('no');
  });
});

describe('executeTool — run_terminal stdin Tier A', () => {
  it('passes replies through to the host', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 's1',
        name: 'run_terminal',
        input: {
          cmd: '__WALKCROACH_ECHO_STDIN__',
          replies: ['y', 'n'],
        },
      },
    });
    expect(result.status).toBe('success');
    expect(result.content).toBe('y\nn\n');
  });

  it('rejects stdin on background mode', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 's2',
        name: 'run_terminal',
        input: {
          cmd: 'npx vite',
          mode: 'background',
          replies: ['y'],
        },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toMatch(/blocking mode/i);
  });
});

describe('prompt — Tier A guidance', () => {
  it('mentions replies / non-interactive flags', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/replies/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/-y/);
  });
});
