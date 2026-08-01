import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultSettings,
  formatRuleCatalog,
  isBackgroundAllowed,
  isVerifyCommand,
  loadMcpServersConfig,
  loadRuleBody,
  loadWorkspaceAgentConfig,
  matchesDenyPattern,
  matchesGlob,
  parseMcpServersJson,
  parseRuleFrontmatter,
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

  it('matchesGlob is the same matcher, shared with rule-file globs scoping', () => {
    expect(matchesGlob).toBe(matchesDenyPattern);
    expect(matchesGlob('web/src/App.tsx', '**/*.tsx')).toBe(true);
    expect(matchesGlob('web/src/App.ts', '**/*.tsx')).toBe(false);
    expect(matchesGlob('package.json', 'package.json')).toBe(true);
  });
});

describe('parseRuleFrontmatter', () => {
  it('treats a file with no frontmatter as a legacy plain rule', () => {
    const { attrs, body } = parseRuleFrontmatter('Use relative imports.');
    expect(attrs).toEqual({});
    expect(body).toBe('Use relative imports.');
  });

  it('parses name/description/globs/alwaysApply and strips the frontmatter block from body', () => {
    const raw = [
      '---',
      'name: react-components',
      'description: React component conventions',
      'globs: web/src/**/*.tsx, web/src/**/*.jsx',
      'alwaysApply: false',
      '---',
      '',
      'Use function components only.',
    ].join('\n');
    const { attrs, body } = parseRuleFrontmatter(raw);
    expect(attrs.name).toBe('react-components');
    expect(attrs.description).toBe('React component conventions');
    expect(attrs.globs).toEqual(['web/src/**/*.tsx', 'web/src/**/*.jsx']);
    expect(attrs.alwaysApply).toBe(false);
    expect(body.trim()).toBe('Use function components only.');
  });

  it('accepts a bracketed globs value and a single bare glob', () => {
    expect(
      parseRuleFrontmatter(['---', 'globs: [a/**, b/**]', '---', 'x'].join('\n'))
        .attrs.globs,
    ).toEqual(['a/**', 'b/**']);
    expect(
      parseRuleFrontmatter(['---', 'globs: *.tsx', '---', 'x'].join('\n')).attrs
        .globs,
    ).toEqual(['*.tsx']);
  });

  it('parses alwaysApply: true', () => {
    expect(
      parseRuleFrontmatter(['---', 'alwaysApply: true', '---', 'x'].join('\n'))
        .attrs.alwaysApply,
    ).toBe(true);
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
    expect(cfg.ruleCatalog).toEqual([]);
  });

  it('glob-scoped rule is included only when activeFile matches, and appears in the catalog otherwise', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-cfg-'));
    await mkdir(join(dir, '.walkcroach', 'rules'), { recursive: true });
    await writeFile(
      join(dir, '.walkcroach', 'rules', 'react.md'),
      [
        '---',
        'description: React component conventions',
        'globs: **/*.tsx',
        '---',
        '',
        'Use function components only.',
      ].join('\n'),
      'utf8',
    );

    const noMatch = await loadWorkspaceAgentConfig(dir, {
      activeFile: 'src/index.ts',
    });
    expect(noMatch.rulesMd).toBe('');
    expect(noMatch.ruleFiles).toEqual([]);
    expect(noMatch.ruleCatalog).toEqual([
      { name: 'react', description: 'React component conventions' },
    ]);

    const matched = await loadWorkspaceAgentConfig(dir, {
      activeFile: 'src/App.tsx',
    });
    expect(matched.rulesMd).toContain('Use function components only');
    expect(matched.ruleFiles).toEqual(['.walkcroach/rules/react.md']);
    expect(matched.ruleCatalog).toEqual([]);

    const noActiveFile = await loadWorkspaceAgentConfig(dir);
    expect(noActiveFile.rulesMd).toBe('');
    expect(noActiveFile.ruleCatalog).toHaveLength(1);
  });

  it('description-only rule (no globs, no explicit alwaysApply) is manual/catalog-only', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-cfg-'));
    await mkdir(join(dir, '.walkcroach', 'rules'), { recursive: true });
    await writeFile(
      join(dir, '.walkcroach', 'rules', 'deploy.md'),
      [
        '---',
        'name: deploy-checklist',
        'description: Steps to run before deploying',
        '---',
        '',
        '1. Run migrations.\n2. Bump version.',
      ].join('\n'),
      'utf8',
    );

    const cfg = await loadWorkspaceAgentConfig(dir);
    expect(cfg.rulesMd).toBe('');
    expect(cfg.ruleFiles).toEqual([]);
    expect(cfg.ruleCatalog).toEqual([
      { name: 'deploy-checklist', description: 'Steps to run before deploying' },
    ]);
  });

  it('alwaysApply: true wins over globs/description', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-cfg-'));
    await mkdir(join(dir, '.walkcroach', 'rules'), { recursive: true });
    await writeFile(
      join(dir, '.walkcroach', 'rules', 'core.md'),
      [
        '---',
        'description: Core conventions',
        'globs: **/*.tsx',
        'alwaysApply: true',
        '---',
        '',
        'Always use TypeScript strict mode.',
      ].join('\n'),
      'utf8',
    );

    const cfg = await loadWorkspaceAgentConfig(dir, {
      activeFile: 'unrelated.py',
    });
    expect(cfg.rulesMd).toContain('Always use TypeScript strict mode');
    expect(cfg.ruleCatalog).toEqual([]);
  });
});

describe('loadRuleBody', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('loads a manual rule body by name and returns null for unknown names', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-cfg-'));
    await mkdir(join(dir, '.walkcroach', 'rules'), { recursive: true });
    await writeFile(
      join(dir, '.walkcroach', 'rules', 'deploy.md'),
      [
        '---',
        'name: deploy-checklist',
        'description: Steps to run before deploying',
        '---',
        '',
        '1. Run migrations.',
      ].join('\n'),
      'utf8',
    );

    const found = await loadRuleBody(dir, 'deploy-checklist');
    expect(found?.name).toBe('deploy-checklist');
    expect(found?.description).toBe('Steps to run before deploying');
    expect(found?.body.trim()).toBe('1. Run migrations.');

    expect(await loadRuleBody(dir, 'nonexistent')).toBeNull();
    expect(await loadRuleBody(undefined, 'deploy-checklist')).toBeNull();
  });
});

describe('formatRuleCatalog', () => {
  it('formats entries as a bullet list, empty string when none', () => {
    expect(formatRuleCatalog([])).toBe('');
    expect(
      formatRuleCatalog([{ name: 'deploy-checklist', description: 'Steps' }]),
    ).toBe('- deploy-checklist: Steps');
  });
});

describe('parseMcpServersJson', () => {
  const orig = process.env.GH_TOKEN;
  afterEach(() => {
    if (orig !== undefined) process.env.GH_TOKEN = orig;
    else delete process.env.GH_TOKEN;
  });

  it('parses the mcpServers map, skipping entries with neither url nor command', () => {
    const out = parseMcpServersJson({
      mcpServers: {
        github: { url: 'https://mcp.example.com/github', headers: { 'X-Key': 'abc' } },
        broken: { headers: { 'X-Key': 'abc' } },
      },
    });
    expect(out).toEqual({
      github: {
        transport: 'http',
        url: 'https://mcp.example.com/github',
        headers: { 'X-Key': 'abc' },
      },
    });
  });

  it('recognises a stdio entry rather than silently dropping it', () => {
    // Recognition is not permission: whether it may run is decided by the host
    // (HostAdapter.isStdioMcpAllowed), never by this file. Parsing it here is
    // what lets the caller warn about an ignored server.
    const out = parseMcpServersJson({
      mcpServers: {
        fs: { command: 'npx', args: ['-y', 'server-filesystem', '/'], env: ['FOO'] },
      },
    });
    expect(out.fs).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server-filesystem', '/'],
      env: ['FOO'],
    });
  });

  it('does not interpolate ${env:VAR} into a stdio env allowlist', () => {
    // These are variable NAMES to pass through. Expanding them would write a
    // secret's value into a committed file's semantics.
    process.env.GH_TOKEN = 'secret-123';
    const out = parseMcpServersJson({
      mcpServers: { fs: { command: 'npx', env: ['${env:GH_TOKEN}'] } },
    });
    expect((out.fs as { env: string[] }).env).toEqual(['${env:GH_TOKEN}']);
  });

  it('prefers url when an entry somehow has both', () => {
    const out = parseMcpServersJson({
      mcpServers: { both: { url: 'https://x.example/mcp', command: 'npx' } },
    });
    expect(out.both?.transport).toBe('http');
  });

  it('interpolates ${env:VAR} in header values', () => {
    process.env.GH_TOKEN = 'secret-123';
    const out = parseMcpServersJson({
      mcpServers: {
        github: {
          url: 'https://mcp.example.com/github',
          headers: { Authorization: 'Bearer ${env:GH_TOKEN}' },
        },
      },
    });
    expect(out.github?.headers?.Authorization).toBe('Bearer secret-123');
  });

  it('returns an empty object for missing/malformed input', () => {
    expect(parseMcpServersJson(null)).toEqual({});
    expect(parseMcpServersJson({})).toEqual({});
    expect(parseMcpServersJson({ mcpServers: 'nope' })).toEqual({});
  });
});

describe('loadMcpServersConfig', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('loads .walkcroach/mcp.json from disk, empty object when missing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-mcp-'));
    expect(await loadMcpServersConfig(dir)).toEqual({});

    await mkdir(join(dir, '.walkcroach'), { recursive: true });
    await writeFile(
      join(dir, '.walkcroach', 'mcp.json'),
      JSON.stringify({
        mcpServers: { github: { url: 'https://mcp.example.com/github' } },
      }),
      'utf8',
    );
    expect(await loadMcpServersConfig(dir)).toEqual({
      github: { transport: 'http', url: 'https://mcp.example.com/github' },
    });
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

    const withCatalog = assembleSystemBlocks({
      ruleCatalog: '- deploy-checklist: Steps to run before deploying',
    });
    expect(JSON.stringify(withCatalog)).toContain('Available project rules');
    expect(JSON.stringify(withCatalog)).toContain('deploy-checklist');

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
