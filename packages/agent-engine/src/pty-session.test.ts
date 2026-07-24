import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import {
  InteractiveSessionRegistry,
  splitCommandLine,
  resetPtyModuleCache,
} from './pty-session.js';
import { createFakeHost } from './fake-host.js';
import { executeTool } from './tools/execute.js';

const echoRepl = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'echo-repl.cjs',
);
const echoCmd = `node "${echoRepl}"`;

afterEach(() => {
  resetPtyModuleCache(true);
});

describe('splitCommandLine', () => {
  it('splits simple tokens', () => {
    expect(splitCommandLine('python -i')).toEqual({
      file: 'python',
      args: ['-i'],
      viaShell: false,
    });
  });

  it('respects quotes', () => {
    const r = splitCommandLine('node -e "console.log(1)"');
    expect(r.file).toBe('node');
    expect(r.args).toEqual(['-e', 'console.log(1)']);
    expect(r.viaShell).toBe(false);
  });

  it('routes operators through shell', () => {
    const r = splitCommandLine('echo hi && echo bye');
    expect(r.viaShell).toBe(true);
  });
});

describe('InteractiveSessionRegistry — pipe backend', () => {
  it('start → write → read → close with a line echoer', async () => {
    const reg = new InteractiveSessionRegistry({ forcePipe: true });
    const info = await reg.start({ cmd: echoCmd, cwd: process.cwd() });
    expect(info.backend).toBe('pipe');
    expect(info.status).toBe('running');

    const first = await reg.read(info.sessionId, {
      timeoutMs: 5_000,
      settleMs: 150,
    });
    expect(first.output).toContain('ready');

    reg.write(info.sessionId, 'hello');
    const second = await reg.read(info.sessionId, {
      timeoutMs: 5_000,
      settleMs: 150,
    });
    expect(second.output).toContain('echo:hello');

    reg.write(info.sessionId, 'quit');
    const third = await reg.read(info.sessionId, {
      timeoutMs: 5_000,
      settleMs: 200,
    });
    expect(third.status === 'exited' || third.output.includes('echo:quit')).toBe(
      true,
    );

    expect(reg.close(info.sessionId)).toBe(true);
    expect(reg.list()).toHaveLength(0);
  }, 20_000);

  it('enforces max sessions', async () => {
    const reg = new InteractiveSessionRegistry({ forcePipe: true });
    const cmd = `node "${echoRepl}"`;
    const ids: string[] = [];
    try {
      for (let i = 0; i < 4; i++) {
        const s = await reg.start({ cmd, cwd: process.cwd() });
        ids.push(s.sessionId);
      }
      await expect(reg.start({ cmd, cwd: process.cwd() })).rejects.toThrow(
        /Too many interactive sessions/,
      );
    } finally {
      reg.killAll();
    }
  }, 20_000);
});

describe('executeTool — terminal_session', () => {
  it('runs start/write/read/close through the fake host', async () => {
    const host = createFakeHost({ autoApprove: true });

    const start = await executeTool({
      host,
      tool: {
        toolUseId: 's1',
        name: 'terminal_session',
        input: { action: 'start', cmd: echoCmd },
      },
    });
    expect(start.status).toBe('success');
    const idMatch = /session_id:\s*(\S+)/.exec(start.content);
    expect(idMatch).toBeTruthy();
    const sessionId = idMatch![1]!;

    const ready = await executeTool({
      host,
      tool: {
        toolUseId: 's2',
        name: 'terminal_session',
        input: {
          action: 'read',
          session_id: sessionId,
          settle_ms: 150,
          timeout_ms: 5_000,
        },
      },
    });
    expect(ready.content).toContain('ready');

    const write = await executeTool({
      host,
      tool: {
        toolUseId: 's3',
        name: 'terminal_session',
        input: { action: 'write', session_id: sessionId, input: 'ping' },
      },
    });
    expect(write.status).toBe('success');

    const read = await executeTool({
      host,
      tool: {
        toolUseId: 's4',
        name: 'terminal_session',
        input: {
          action: 'read',
          session_id: sessionId,
          timeout_ms: 5_000,
          settle_ms: 150,
        },
      },
    });
    expect(read.status).toBe('success');
    expect(read.content).toContain('echo:ping');

    const close = await executeTool({
      host,
      tool: {
        toolUseId: 's5',
        name: 'terminal_session',
        input: { action: 'close', session_id: sessionId },
      },
    });
    expect(close.status).toBe('success');
  }, 25_000);
});
