import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearActiveAgentSession,
  loadAgentSession,
  newSessionId,
  persistAgentSession,
  readActiveSessionPointer,
} from './session-store.js';
import {
  assertHookCommandSafe,
  hookMatches,
  parseHooksConfig,
  runPostToolUseHooks,
} from './hooks.js';
import { parseSettingsJson } from './workspace-config.js';

describe('session-store', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('persists and reloads messages + transcript', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-sess-'));
    const sessionId = newSessionId();
    await persistAgentSession(dir, {
      sessionId,
      messages: [
        { role: 'user', content: [{ text: 'hello' }] },
        { role: 'assistant', content: [{ text: 'hi' }] },
      ],
      transcript: 'hello\nhi',
    });

    const active = await readActiveSessionPointer(dir);
    expect(active?.sessionId).toBe(sessionId);

    const loaded = await loadAgentSession(dir);
    expect(loaded?.sessionId).toBe(sessionId);
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.transcript).toBe('hello\nhi');

    const jsonl = await readFile(
      join(dir, '.walkcroach', 'sessions', sessionId, 'messages.jsonl'),
      'utf8',
    );
    expect(jsonl.trim().split('\n')).toHaveLength(2);
  });

  it('clears active session and deletes files', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-sess-'));
    const sessionId = newSessionId();
    await persistAgentSession(dir, {
      sessionId,
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
    });
    await clearActiveAgentSession(dir);
    expect(await readActiveSessionPointer(dir)).toBeNull();
    expect(await loadAgentSession(dir)).toBeNull();
  });

  it('prunes old sessions beyond maxSessions', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-sess-'));
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `s${i}${newSessionId().slice(0, 6)}`;
      ids.push(id);
      await persistAgentSession(
        dir,
        {
          sessionId: id,
          messages: [{ role: 'user', content: [{ text: `m${i}` }] }],
        },
        { maxSessions: 2 },
      );
      // Ensure distinct updatedAt ordering
      await new Promise((r) => setTimeout(r, 15));
    }
    const root = join(dir, '.walkcroach', 'sessions');
    const { readdir } = await import('node:fs/promises');
    const left = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(left.length).toBeLessThanOrEqual(2);
    expect(left).toContain(ids[ids.length - 1]!);
  });
});

describe('hooks config', () => {
  it('parses PostToolUse from settings.hooks', () => {
    const s = parseSettingsJson({
      hooks: {
        PostToolUse: [
          { matcher: 'write_file|edit_file', command: '.walkcroach/hooks/audit.mjs' },
          { command: '' },
        ],
      },
    });
    expect(s.hooks.PostToolUse).toHaveLength(1);
    expect(s.hooks.PostToolUse[0]?.command).toContain('audit.mjs');
    expect(s.session.persist).toBe(true);
  });

  it('matches tool names with regex', () => {
    expect(hookMatches('write_file|edit_file', 'edit_file')).toBe(true);
    expect(hookMatches('verify', 'run_terminal')).toBe(false);
    expect(hookMatches('.*', 'todo_write')).toBe(true);
  });

  it('rejects hook paths that escape the workspace', () => {
    expect(() =>
      assertHookCommandSafe('/tmp/ws', '../outside.sh'),
    ).toThrow(/escapes/);
    expect(assertHookCommandSafe('/tmp/ws', '.walkcroach/hooks/a.mjs')).toContain(
      'hooks',
    );
    expect(assertHookCommandSafe('/tmp/ws', 'echo ok')).toBe('echo ok');
  });

  it('runs a successful PostToolUse hook via shell', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wc-hook-'));
    try {
      await mkdir(join(dir, '.walkcroach', 'hooks'), { recursive: true });
      // Cross-platform: node -e reads stdin and exits 0
      const warnings = await runPostToolUseHooks({
        workspaceRoot: dir,
        hooks: [
          {
            matcher: 'write_file',
            command: 'node -e "process.stdin.resume(); process.stdin.on(\'end\',()=>process.exit(0))"',
            timeoutMs: 5000,
          },
        ],
        toolName: 'write_file',
        toolInput: { path: 'a.ts' },
        toolStatus: 'success',
        toolContent: 'Wrote a.ts',
      });
      expect(warnings).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('surfaces hook failure as warning string', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wc-hook-fail-'));
    try {
      const warnings = await runPostToolUseHooks({
        workspaceRoot: dir,
        hooks: [
          {
            matcher: '.*',
            command: 'node -e "process.exit(2)"',
            timeoutMs: 5000,
          },
        ],
        toolName: 'verify',
        toolInput: {},
        toolStatus: 'success',
        toolContent: 'ok',
      });
      expect(warnings[0]).toContain('PostToolUse hook failed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parseHooksConfig accepts nested hooks object', () => {
    const h = parseHooksConfig({
      hooks: { PostToolUse: [{ command: 'echo hi', timeoutMs: 1000 }] },
    });
    expect(h.PostToolUse[0]?.timeoutMs).toBe(1000);
  });
});
