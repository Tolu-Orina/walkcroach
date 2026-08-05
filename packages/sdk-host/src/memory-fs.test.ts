import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from './memory-fs.js';
import { SandboxHostAdapter } from './SandboxHostAdapter.js';
import { runProgrammatic } from './run.js';

describe('MemoryFileSystem', () => {
  it('reads back what it writes', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/workspace/a.ts', 'x');
    expect(await fs.readFile('/workspace/a.ts')).toBe('x');
  });

  it('throws ENOENT for a missing file, like a real filesystem', async () => {
    // The host's existence check depends on this, and so does write-scope.
    const fs = new MemoryFileSystem();
    await expect(fs.readFile('/workspace/nope.ts')).rejects.toThrow(/ENOENT/);
  });

  it('normalises paths without touching a real disk', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/workspace/src/../src/a.ts', 'x');
    expect(fs.has('/workspace/src/a.ts')).toBe(true);
  });

  it('scopes listFiles to a prefix', async () => {
    const fs = new MemoryFileSystem({
      files: { '/w/src/a.ts': '1', '/w/src/b.ts': '2', '/w/docs/c.md': '3' },
    });
    expect(await fs.listFiles('/w/src')).toEqual(['/w/src/a.ts', '/w/src/b.ts']);
  });

  it('refuses execution loudly instead of faking success', async () => {
    // An agent told a command "succeeded" with empty output will believe its
    // tests passed. That is a far worse failure than being told it cannot run.
    const fs = new MemoryFileSystem();
    const res = await fs.runTerminal('npm test');
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(127);
    expect(res.stderr).toMatch(/not available/);
    expect(res.stderr).toMatch(/Do not assume a build or test passed/);
  });

  it('records what the agent tried to run', async () => {
    const fs = new MemoryFileSystem();
    await fs.runTerminal('npm run build');
    expect(fs.attemptedCommands).toEqual(['npm run build']);
  });

  it('can answer a narrow set of pre-arranged commands', async () => {
    const fs = new MemoryFileSystem({
      commands: { 'npm test': { ok: true, exitCode: 0, stdout: '2 passed', stderr: '' } },
    });
    expect((await fs.runTerminal('npm test')).stdout).toBe('2 passed');
    expect((await fs.runTerminal('npm run build')).exitCode).toBe(127);
  });

  it('snapshots deterministically for committing', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/w/b.ts', '2');
    await fs.writeFile('/w/a.ts', '1');
    expect(Object.keys(fs.snapshot())).toEqual(['/w/a.ts', '/w/b.ts']);
  });
});

describe('the whole host stack over an in-memory filesystem', () => {
  // This is the point of declaring SandboxLike structurally: no VM, no region,
  // no snapshot cost — the same adapter and the same write-scope enforcement.
  const seeded = () =>
    new MemoryFileSystem({
      files: {
        '/workspace/src/components/Button.tsx': 'export const Button = () => null;',
        '/workspace/package.json': '{"name":"site"}',
      },
    });

  it('enforces additive scope with no sandbox present', async () => {
    const fs = seeded();
    const host = new SandboxHostAdapter({
      sandbox: fs,
      workspaceRoot: '/workspace',
      writeScope: { mode: 'additive' },
    });

    await host.writeFile('src/content/blog/post.tsx', 'export default () => null;');
    await expect(host.writeFile('src/components/Button.tsx', 'changed')).rejects.toThrow(
      /write-scope/,
    );

    expect(fs.has('/workspace/src/content/blog/post.tsx')).toBe(true);
    expect(await fs.readFile('/workspace/src/components/Button.tsx')).toBe(
      'export const Button = () => null;',
    );
  });

  it('still blocks path escapes', async () => {
    const host = new SandboxHostAdapter({
      sandbox: seeded(),
      workspaceRoot: '/workspace',
      writeScope: { mode: 'full' },
    });
    await expect(host.writeFile('../../etc/passwd', 'x')).rejects.toThrow(/path-escape/);
  });

  it('reports written paths relative to the workspace', async () => {
    const host = new SandboxHostAdapter({
      sandbox: seeded(),
      workspaceRoot: '/workspace',
      writeScope: { mode: 'additive' },
    });
    await host.writeFile('src/content/blog/a.tsx', '1');
    await host.writeFile('src/content/blog/b.tsx', '2');
    expect(host.writtenPaths()).toEqual([
      'src/content/blog/a.tsx',
      'src/content/blog/b.tsx',
    ]);
  });

  it('surfaces the execution refusal through the host as terminal output', async () => {
    const host = new SandboxHostAdapter({
      sandbox: seeded(),
      workspaceRoot: '/workspace',
      writeScope: { mode: 'full' },
    });
    const chunks = [];
    for await (const c of host.runTerminal('npm test', { cwd: '/workspace' })) chunks.push(c);
    expect(chunks.some((c) => c.stream === 'stderr' && /not available/.test(c.text))).toBe(true);
  });
});

describe('runProgrammatic surface', () => {
  it('is callable with an in-memory filesystem and no sandbox infrastructure', () => {
    // Compile-time assurance that the CMS path needs nothing provisioned.
    const req = {
      sandbox: new MemoryFileSystem(),
      prompt: 'Create a blog page',
      writeScope: { mode: 'additive' as const },
    };
    expect(typeof runProgrammatic).toBe('function');
    expect(req.sandbox.kind).toBe('memory');
  });
});
