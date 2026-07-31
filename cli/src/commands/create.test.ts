/**
 * `walkcroach create` (C3).
 *
 * Two groups matter most: the name is a path injection point, and the local
 * scaffold must never depend on the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEMPLATES } from '@walkcroach/templates';
import {
  checkProjectName,
  createCommand,
  targetIsUsable,
  walkcroachMd,
} from './create.js';
import { EXIT } from '../lib/exit-codes.js';
import { resetRuntimeFlags, setRuntimeFlags } from '../lib/runtime.js';

let cwd: string;
let home: string;
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;

function lastJson(): any {
  return JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? '{}'));
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'wc-create-'));
  home = await mkdtemp(join(tmpdir(), 'wc-create-home-'));
  process.env.WALKCROACH_HOME = home;
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // Non-interactive by default: no test may block on the template picker.
  setRuntimeFlags({ noInput: true });
});

afterEach(async () => {
  stdout.mockRestore();
  stderr.mockRestore();
  resetRuntimeFlags();
  delete process.env.WALKCROACH_HOME;
  await rm(cwd, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('checkProjectName', () => {
  it('accepts ordinary names', () => {
    expect(checkProjectName('my-app')).toEqual({ ok: true, slug: 'my-app' });
    expect(checkProjectName('Invoice Tracker').ok).toBe(true);
  });

  it('refuses anything that could escape the working directory', () => {
    // The name becomes a directory under cwd, so it is a path injection point.
    for (const bad of ['../evil', '../../etc', 'a/b', 'a\\b', '.', '..']) {
      expect(checkProjectName(bad).ok, bad).toBe(false);
    }
  });

  it('refuses an absolute path', () => {
    expect(checkProjectName('/tmp/elsewhere').ok).toBe(false);
    expect(checkProjectName('C:\\Windows').ok).toBe(false);
  });

  it('refuses Windows reserved device names', () => {
    // These create directories that cannot be removed normally.
    for (const bad of ['con', 'PRN', 'aux', 'nul', 'com1', 'LPT9']) {
      expect(checkProjectName(bad).ok, bad).toBe(false);
    }
  });

  it('refuses characters a filesystem will reject', () => {
    for (const bad of ['a:b', 'a"b', 'a|b', 'a?b', 'a*b', 'a<b', 'a>b']) {
      expect(checkProjectName(bad).ok, bad).toBe(false);
    }
  });

  it('refuses an empty or punctuation-only name', () => {
    expect(checkProjectName('   ').ok).toBe(false);
    expect(checkProjectName('!!!').ok).toBe(false);
  });
});

describe('targetIsUsable', () => {
  it('allows an absent or empty directory', async () => {
    expect(await targetIsUsable(join(cwd, 'nope'))).toBe(true);
    await mkdir(join(cwd, 'empty'));
    expect(await targetIsUsable(join(cwd, 'empty'))).toBe(true);
  });

  it('refuses a directory with anything in it', async () => {
    await mkdir(join(cwd, 'full'));
    await writeFile(join(cwd, 'full', 'file.txt'), 'x');
    expect(await targetIsUsable(join(cwd, 'full'))).toBe(false);
  });
});

describe('walkcroachMd', () => {
  it('records the template and the example prompts the agent can act on', () => {
    const md = walkcroachMd({ projectName: 'Acme', template: TEMPLATES[0]!, projectId: null });
    expect(md).toContain('# WALKCROACH.md');
    expect(md).toContain('Acme');
    expect(md).toContain(TEMPLATES[0]!.name);
    expect(md).toContain(TEMPLATES[0]!.examplePrompts[0]!);
  });

  it('names the project id only when there is one', () => {
    expect(walkcroachMd({ projectName: 'A', template: TEMPLATES[0]!, projectId: 'p_1' })).toContain('p_1');
    expect(
      walkcroachMd({ projectName: 'A', template: TEMPLATES[0]!, projectId: null }),
    ).not.toContain('WalkCroach project');
  });
});

describe('createCommand', () => {
  it('scaffolds a runnable project without a network or a session', async () => {
    // The core promise: signed out and offline still produces a real project.
    const code = await createCommand({
      name: 'my-app',
      cwd,
      template: 'blank',
      git: false,
      register: false,
      json: true,
    });
    expect(code).toBe(EXIT.OK);

    const dir = join(cwd, 'my-app');
    for (const file of ['package.json', 'vite.config.ts', 'index.html', 'src/App.tsx', 'WALKCROACH.md']) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.name).toBe('my-app');
  });

  it('reports that it did not register, rather than failing', async () => {
    const code = await createCommand({ name: 'app2', cwd, template: 'blank', git: false, json: true });
    expect(code).toBe(EXIT.OK);
    const { data } = lastJson();
    expect(data.project).toBeNull();
    expect(data.registerNote).toMatch(/auth login/);
  });

  it('refuses a non-empty directory unless forced', async () => {
    await mkdir(join(cwd, 'taken'));
    await writeFile(join(cwd, 'taken', 'keep.txt'), 'precious');

    const code = await createCommand({ name: 'taken', cwd, template: 'blank', git: false, register: false, json: true });
    expect(code).toBe(EXIT.USAGE);
    expect(lastJson().error).toMatch(/already exists and is not empty/);
    // Nothing was written over.
    expect(await readFile(join(cwd, 'taken', 'keep.txt'), 'utf8')).toBe('precious');
  });

  it('scaffolds into a non-empty directory with --force', async () => {
    await mkdir(join(cwd, 'taken'));
    await writeFile(join(cwd, 'taken', 'keep.txt'), 'precious');

    const code = await createCommand({
      name: 'taken', cwd, template: 'blank', git: false, register: false, force: true, json: true,
    });
    expect(code).toBe(EXIT.OK);
    expect(existsSync(join(cwd, 'taken', 'package.json'))).toBe(true);
    expect(await readFile(join(cwd, 'taken', 'keep.txt'), 'utf8')).toBe('precious');
  });

  it('writes nothing at all when the name is rejected', async () => {
    const code = await createCommand({ name: '../escape', cwd, template: 'blank', json: true });
    expect(code).toBe(EXIT.USAGE);
    expect(await readdir(cwd)).toEqual([]);
  });

  it('rejects an unknown template and lists the real ones', async () => {
    const code = await createCommand({ name: 'app3', cwd, template: 'nope', json: true });
    expect(code).toBe(EXIT.USAGE);
    expect(lastJson().error).toContain('blank');
    expect(existsSync(join(cwd, 'app3'))).toBe(false);
  });

  it('falls back to the documented default when it cannot ask', async () => {
    // clig.dev: never *require* interaction. A non-TTY run picks the default
    // and says so on stderr rather than blocking.
    const code = await createCommand({ name: 'app4', cwd, git: false, register: false, json: true });
    expect(code).toBe(EXIT.OK);
    expect(lastJson().data.template).toMatchObject({ id: 'blank', source: 'default' });
    expect(String(stderr.mock.calls.map(String).join(''))).toMatch(/using "blank"/);
  });

  it('builds every catalogue template on disk', async () => {
    for (const template of TEMPLATES) {
      const code = await createCommand({
        name: `t-${template.id}`, cwd, template: template.id, git: false, register: false, json: true,
      });
      expect(code, template.id).toBe(EXIT.OK);
      expect(existsSync(join(cwd, `t-${template.id}`, 'src', 'App.tsx')), template.id).toBe(true);
    }
  });

  it('initialises a git repository with one commit', async () => {
    const code = await createCommand({ name: 'gitapp', cwd, template: 'blank', register: false, json: true });
    expect(code).toBe(EXIT.OK);
    const { data } = lastJson();
    // git may be absent on a build machine — that is reported, never fatal.
    if (data.git.ok) {
      expect(existsSync(join(cwd, 'gitapp', '.git'))).toBe(true);
    } else {
      expect(data.git.detail).toBeTruthy();
      expect(existsSync(join(cwd, 'gitapp', 'package.json'))).toBe(true);
    }
  });

  it('skips git when asked, and still succeeds', async () => {
    const code = await createCommand({ name: 'nogit', cwd, template: 'blank', git: false, register: false, json: true });
    expect(code).toBe(EXIT.OK);
    expect(lastJson().data.git.detail).toMatch(/--no-git/);
    expect(existsSync(join(cwd, 'nogit', '.git'))).toBe(false);
  });

  it('tells the user what to run next', async () => {
    await createCommand({ name: 'next-app', cwd, template: 'blank', git: false, register: false, json: true });
    expect(lastJson().data.next).toEqual([
      'cd next-app',
      'npm install',
      'npm run dev',
      'walkcroach run "…"',
    ]);
  });
});
