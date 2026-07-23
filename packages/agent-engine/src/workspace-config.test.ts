import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultSettings,
  isBackgroundAllowed,
  isVerifyCommand,
  loadWorkspaceAgentConfig,
  matchesDenyPattern,
  parseSettingsJson,
  parseVerifyJson,
} from './workspace-config.js';
import { WorkspacePolicy } from './workspace-policy.js';
import { createFakeHost } from './fake-host.js';
import { executeTool } from './tools/execute.js';
import { assembleSystemBlocks, buildUserTurn } from './prompt.js';
import { buildVerifyNudgePrompt } from './loop.js';

describe('workspace-config parsers', () => {
  it('parses settings with clamps', () => {
    const s = parseSettingsJson({
      autonomy: 'low_friction',
      terminal: {
        defaultTimeoutMs: 999_999,
        backgroundAllowlist: ['vite', ' next '],
      },
      denyPaths: ['secrets/**', 'private.key'],
      verify: { required: false, maxNudges: 9 },
    });
    expect(s.autonomy).toBe('low_friction');
    expect(s.terminal.defaultTimeoutMs).toBe(600_000);
    expect(s.terminal.backgroundAllowlist).toEqual(['vite', 'next']);
    expect(s.denyPaths).toEqual(['secrets/**', 'private.key']);
    expect(s.verify.required).toBe(false);
    expect(s.verify.maxNudges).toBe(3);
  });

  it('parses verify array and object forms', () => {
    expect(parseVerifyJson(['npm test', '  ']).commands).toEqual(['npm test']);
    expect(
      parseVerifyJson({ commands: ['npm run typecheck'], cwd: 'apps/web' }),
    ).toEqual({ commands: ['npm run typecheck'], cwd: 'apps/web' });
  });

  it('matches verify commands case/whitespace-insensitively', () => {
    const v = parseVerifyJson(['npm  test']);
    expect(isVerifyCommand('NPM test', v)).toBe(true);
    expect(isVerifyCommand('npm run build', v)).toBe(false);
  });

  it('enforces background allowlist when non-empty', () => {
    expect(isBackgroundAllowed('npx vite', [])).toBe(true);
    expect(isBackgroundAllowed('npx vite', ['vite'])).toBe(true);
    expect(isBackgroundAllowed('npm start', ['vite'])).toBe(false);
  });

  it('matches deny path patterns', () => {
    expect(matchesDenyPattern('secrets/foo.txt', 'secrets/**')).toBe(true);
    expect(matchesDenyPattern('src/private.key', 'private.key')).toBe(true);
    expect(matchesDenyPattern('src/app.ts', 'secrets/**')).toBe(false);
  });
});

describe('loadWorkspaceAgentConfig', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('loads settings, verify, and rules from disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-cfg-'));
    await mkdir(join(dir, '.walkcroach', 'rules'), { recursive: true });
    await writeFile(
      join(dir, '.walkcroach', 'settings.json'),
      JSON.stringify({
        autonomy: 'strict',
        denyPaths: ['vault/**'],
        terminal: { defaultTimeoutMs: 30_000, backgroundAllowlist: ['vite'] },
      }),
      'utf8',
    );
    await writeFile(
      join(dir, '.walkcroach', 'verify.json'),
      JSON.stringify(['npm test']),
      'utf8',
    );
    await writeFile(
      join(dir, '.walkcroach', 'rules', '01-style.md'),
      'Use relative imports.',
      'utf8',
    );

    const cfg = await loadWorkspaceAgentConfig(dir);
    expect(cfg.settings.terminal.defaultTimeoutMs).toBe(30_000);
    expect(cfg.settings.denyPaths).toEqual(['vault/**']);
    expect(cfg.verify.commands).toEqual(['npm test']);
    expect(cfg.rulesMd).toContain('Use relative imports');
    expect(cfg.ruleFiles).toEqual(['.walkcroach/rules/01-style.md']);
  });
});

describe('WorkspacePolicy', () => {
  it('denies built-in sensitive and custom paths', () => {
    const p = new WorkspacePolicy(
      { ...defaultSettings(), denyPaths: ['vault/**'] },
      { commands: ['npm test'], cwd: '.' },
    );
    expect(p.isDeniedPath('.env')).toBe(true);
    expect(p.isDeniedPath('vault/x')).toBe(true);
    expect(p.isDeniedPath('src/a.ts')).toBe(false);
    expect(p.hasVerifyRecipes).toBe(true);
    expect(p.verifyRequired).toBe(true);
  });
});

describe('prompt assembly P1', () => {
  it('includes rules and verify recipes', () => {
    const blocks = assembleSystemBlocks({
      rulesMd: '## 01.md\n\nNo console.log',
    });
    expect(JSON.stringify(blocks)).toContain('Project rules');
    expect(JSON.stringify(blocks)).toContain('No console.log');

    const turn = buildUserTurn({
      prompt: 'fix the bug',
      verifyCommands: ['npm test'],
    });
    expect(turn).toContain('verify.json');
    expect(turn).toContain('npm test');
  });

  it('builds verify nudge prompt', () => {
    const text = buildVerifyNudgePrompt(['npm test', 'npm run typecheck']);
    expect(text).toContain('verify');
    expect(text).toContain('npm test');
  });
});

describe('executeTool — policy', () => {
  it('rejects denied write paths', async () => {
    const host = createFakeHost({ autoApprove: true });
    const policy = new WorkspacePolicy(
      { ...defaultSettings(), denyPaths: ['locked/**'] },
      { commands: [], cwd: '.' },
    );
    const result = await executeTool({
      host,
      policy,
      tool: {
        toolUseId: 'w1',
        name: 'write_file',
        input: { path: 'locked/secret.ts', content: 'x' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('denied');
  });

  it('rejects background when allowlist misses', async () => {
    const host = createFakeHost({ autoApprove: true });
    const policy = new WorkspacePolicy(
      {
        ...defaultSettings(),
        terminal: {
          defaultTimeoutMs: 120_000,
          backgroundAllowlist: ['vite'],
        },
      },
      { commands: [], cwd: '.' },
    );
    const result = await executeTool({
      host,
      policy,
      tool: {
        toolUseId: 'b1',
        name: 'run_terminal',
        input: { cmd: 'python -m http.server', mode: 'background' },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('allowlist');
  });

  it('marks verified on successful verify recipe via run_terminal', async () => {
    const host = createFakeHost({ autoApprove: true });
    const policy = new WorkspacePolicy(defaultSettings(), {
      commands: ['echo hello'],
      cwd: '.',
    });
    const result = await executeTool({
      host,
      policy,
      tool: {
        toolUseId: 'v1',
        name: 'run_terminal',
        input: { cmd: 'echo hello' },
      },
    });
    expect(result.status).toBe('success');
    expect(policy.didVerify).toBe(true);
  });

  it('verify tool requires recipes', async () => {
    const host = createFakeHost({ autoApprove: true });
    const policy = new WorkspacePolicy();
    const result = await executeTool({
      host,
      policy,
      tool: { toolUseId: 'v2', name: 'verify', input: {} },
    });
    expect(result.status).toBe('error');
    expect(result.content).toContain('verify.json');
  });
});
