/**
 * P3.8 — sdk-host failure modes: disk quota, cancel, write-scope refuse.
 */
import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from './memory-fs.js';
import { SandboxHostAdapter } from './SandboxHostAdapter.js';
import { runProgrammatic } from './run.js';

describe('MemoryFileSystem disk quota (P3.8)', () => {
  it('refuses writes that exceed maxBytes', async () => {
    const fs = new MemoryFileSystem({ maxBytes: 20 });
    await fs.writeFile('/a.txt', 'hello');
    await expect(fs.writeFile('/b.txt', 'x'.repeat(30))).rejects.toThrow(
      /disk quota exceeded/,
    );
    expect(fs.has('/b.txt')).toBe(false);
  });

  it('allows replacing a file within the same budget', async () => {
    const fs = new MemoryFileSystem({ maxBytes: 10 });
    await fs.writeFile('/a.txt', '12345');
    await fs.writeFile('/a.txt', '67890');
    expect(await fs.readFile('/a.txt')).toBe('67890');
  });
});

describe('runProgrammatic hardening (P3.8)', () => {
  it('records write-scope refusals without mutating pre-existing files', async () => {
    const fs = new MemoryFileSystem({
      files: { '/workspace/existing.ts': 'keep-me' },
    });
    const host = new SandboxHostAdapter({
      sandbox: fs,
      writeScope: { mode: 'additive' },
      workspaceRoot: '/workspace',
    });
    await expect(host.writeFile('existing.ts', 'mutated')).rejects.toThrow(
      /write-scope/,
    );
    expect(await fs.readFile('/workspace/existing.ts')).toBe('keep-me');
    expect(host.refusals.length).toBeGreaterThan(0);
  });

  it('maps AbortSignal abort to a failed run (cancel path)', async () => {
    const fs = new MemoryFileSystem();
    const ac = new AbortController();
    ac.abort();
    const result = await runProgrammatic({
      sandbox: fs,
      prompt: 'noop',
      writeScope: { mode: 'full' },
      workspaceRoot: '/workspace',
      signal: ac.signal,
      maxIterations: 1,
      timeoutMs: 60_000,
    });
    expect(result.ok).toBe(false);
    expect(['cancelled', 'timeout', 'error', 'input_required']).toContain(
      result.reason,
    );
  });
});
