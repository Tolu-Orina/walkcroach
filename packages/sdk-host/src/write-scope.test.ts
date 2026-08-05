import { describe, expect, it } from 'vitest';
import { SandboxHostAdapter } from './SandboxHostAdapter.js';
import { describeScope, evaluateDelete, evaluateWrite } from './write-scope.js';
import type { SandboxLike } from './sandbox-contract.js';

/** Sandbox pre-loaded with an "existing repository". */
function repoSandbox(existing: Record<string, string>) {
  const files = new Map(Object.entries(existing));
  const commands: string[] = [];
  const sandbox: SandboxLike = {
    kind: 'fake',
    async writeFile(p, c) {
      files.set(p, c);
    },
    async readFile(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async runTerminal(cmd) {
      commands.push(cmd);
      return { ok: true, exitCode: 0, stdout: '', stderr: '' };
    },
    async listFiles() {
      return [...files.keys()];
    },
  };
  return { sandbox, files, commands };
}

describe('evaluateWrite', () => {
  it('always allows creating a file that does not exist', () => {
    for (const scope of [
      { mode: 'additive' } as const,
      { mode: 'scoped', allow: ['src/content'] } as const,
      { mode: 'full' } as const,
    ]) {
      expect(
        evaluateWrite({ scope, path: 'src/new.tsx', preExisting: false, createdInRun: false })
          .allow,
      ).toBe(true);
    }
  });

  it('always allows re-editing a file this run created', () => {
    // Otherwise additive mode breaks normal iteration: write a component, run
    // the type-checker, fix the error you just introduced.
    expect(
      evaluateWrite({
        scope: { mode: 'additive' },
        path: 'src/new.tsx',
        preExisting: true,
        createdInRun: true,
      }).allow,
    ).toBe(true);
  });

  it('refuses modifying a pre-existing file in additive mode', () => {
    const d = evaluateWrite({
      scope: { mode: 'additive' },
      path: 'src/components/Button.tsx',
      preExisting: true,
      createdInRun: false,
    });
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.rule).toBe('write-scope');
    expect(d.allow === false && d.reason).toMatch(/must not modify/i);
  });

  it('allows modifying a pre-existing file inside an allowed scope', () => {
    expect(
      evaluateWrite({
        scope: { mode: 'scoped', allow: ['src/content/blog'] },
        path: 'src/content/blog/index.ts',
        preExisting: true,
        createdInRun: false,
      }).allow,
    ).toBe(true);
  });

  it('refuses a pre-existing file outside the allowed scope', () => {
    expect(
      evaluateWrite({
        scope: { mode: 'scoped', allow: ['src/content/blog'] },
        path: 'tailwind.config.ts',
        preExisting: true,
        createdInRun: false,
      }).allow,
    ).toBe(false);
  });

  it('does not let a scope prefix match a sibling directory', () => {
    // `src/content` must not authorise `src/content-archive`.
    expect(
      evaluateWrite({
        scope: { mode: 'scoped', allow: ['src/content'] },
        path: 'src/content-archive/old.tsx',
        preExisting: true,
        createdInRun: false,
      }).allow,
    ).toBe(false);
  });

  it('allows anything in full mode', () => {
    expect(
      evaluateWrite({
        scope: { mode: 'full' },
        path: 'package.json',
        preExisting: true,
        createdInRun: false,
      }).allow,
    ).toBe(true);
  });
});

describe('evaluateDelete', () => {
  it('permits deleting what this run created', () => {
    expect(
      evaluateDelete({ scope: { mode: 'additive' }, path: 'a.tsx', createdInRun: true }).allow,
    ).toBe(true);
  });

  it('refuses deleting a pre-existing file in additive mode', () => {
    expect(
      evaluateDelete({ scope: { mode: 'additive' }, path: 'a.tsx', createdInRun: false }).allow,
    ).toBe(false);
  });

  it('refuses deleting outside scope, permits inside', () => {
    const scope = { mode: 'scoped', allow: ['src/content'] } as const;
    expect(evaluateDelete({ scope, path: 'src/content/x.tsx', createdInRun: false }).allow).toBe(
      true,
    );
    expect(evaluateDelete({ scope, path: 'src/app/page.tsx', createdInRun: false }).allow).toBe(
      false,
    );
  });
});

describe('describeScope', () => {
  it('tells the model the rule in plain language', () => {
    // The model should know the constraint up front rather than discovering it
    // by being refused mid-run.
    expect(describeScope({ mode: 'additive' })).toMatch(/must NOT modify or delete/);
    expect(describeScope({ mode: 'scoped', allow: ['src/blog'] })).toMatch(/src\/blog/);
    expect(describeScope({ mode: 'full' })).toMatch(/create, modify, and delete/);
  });
});

describe('additive runs against a real repository', () => {
  const existing = {
    '/workspace/src/components/Button.tsx': 'export const Button = () => null;',
    '/workspace/tailwind.config.ts': 'export default {};',
  };

  it('lets the agent add a blog page without touching the repo', async () => {
    const { sandbox, files } = repoSandbox(existing);
    const adapter = new SandboxHostAdapter({
      sandbox,
      workspaceRoot: '/workspace',
      writeScope: { mode: 'additive' },
    });

    await adapter.writeFile('src/content/blog/launch.tsx', 'export default () => null;');
    expect(files.get('/workspace/src/content/blog/launch.tsx')).toBeDefined();
    // The customer's files are byte-identical.
    expect(files.get('/workspace/src/components/Button.tsx')).toBe(existing['/workspace/src/components/Button.tsx']);
  });

  it('refuses to modify an existing component and records the refusal', async () => {
    const { sandbox, files } = repoSandbox(existing);
    const adapter = new SandboxHostAdapter({
      sandbox,
      workspaceRoot: '/workspace',
      writeScope: { mode: 'additive' },
    });

    await expect(
      adapter.writeFile('src/components/Button.tsx', 'export const Button = () => "changed";'),
    ).rejects.toThrow(/write-scope/);

    expect(files.get('/workspace/src/components/Button.tsx')).toBe(
      existing['/workspace/src/components/Button.tsx'],
    );
    expect(adapter.refusals.at(-1)).toMatchObject({ rule: 'write-scope' });
  });

  it('permits iterating on the file it just created', async () => {
    const { sandbox, files } = repoSandbox(existing);
    const adapter = new SandboxHostAdapter({
      sandbox,
      workspaceRoot: '/workspace',
      writeScope: { mode: 'additive' },
    });

    await adapter.writeFile('src/content/blog/launch.tsx', 'v1');
    await adapter.writeFile('src/content/blog/launch.tsx', 'v2');
    await adapter.writeFile('src/content/blog/launch.tsx', 'v3');
    expect(files.get('/workspace/src/content/blog/launch.tsx')).toBe('v3');
  });

  it('refuses to delete anything pre-existing', async () => {
    const { sandbox, commands } = repoSandbox(existing);
    const adapter = new SandboxHostAdapter({
      sandbox,
      workspaceRoot: '/workspace',
      writeScope: { mode: 'additive' },
    });

    await expect(adapter.deleteFile('tailwind.config.ts')).rejects.toThrow(/write-scope/);
    expect(commands.some((c) => c.startsWith('rm '))).toBe(false);
  });

  it('exposes the constraint for the system prompt', () => {
    const { sandbox } = repoSandbox(existing);
    const adapter = new SandboxHostAdapter({
      sandbox,
      workspaceRoot: '/workspace',
      writeScope: { mode: 'additive' },
    });
    expect(adapter.describeWriteScope()).toMatch(/must NOT modify/);
  });
});
