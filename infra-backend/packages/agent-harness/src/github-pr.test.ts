import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentBranchName, openContentPullRequest, readRepoContext } from './github-pr.js';

type Call = { url: string; method: string; body: Record<string, never> | undefined };

/** Canned GitHub API, recording every call so request shape can be asserted. */
function fakeGithub(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const routes: Record<string, unknown> = {
    'GET /repos/acme/site': { default_branch: 'main' },
    'GET /repos/acme/site/git/ref/heads/main': { object: { sha: 'base-sha' } },
    'GET /repos/acme/site/git/commits/base-sha': { tree: { sha: 'base-tree' } },
    'POST /repos/acme/site/git/trees': { sha: 'new-tree' },
    'POST /repos/acme/site/git/commits': { sha: 'new-commit' },
    'POST /repos/acme/site/git/refs': { ref: 'refs/heads/x' },
    'POST /repos/acme/site/pulls': { number: 42, html_url: 'https://github.com/acme/site/pull/42' },
    ...overrides,
  };

  const impl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url).replace('https://api.github.com', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: path, method, body });

    const key = `${method} ${path.split('?')[0]}`;
    if (!(key in routes)) {
      return new Response('not found', { status: 404 });
    }
    const payload = routes[key];
    if (payload instanceof Response) return payload;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  vi.stubGlobal('fetch', impl);
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('contentBranchName', () => {
  it('slugs a title', () => {
    expect(contentBranchName('Why We Chose Drizzle!', 'abc123')).toBe(
      'walkcroach/content/why-we-chose-drizzle-abc123',
    );
  });

  it('always suffixes, so two posts with the same title cannot collide', () => {
    // Reusing a branch would silently fold the first author's changes into the
    // second author's PR.
    const a = contentBranchName('Launch', 'aaa');
    const b = contentBranchName('Launch', 'bbb');
    expect(a).not.toBe(b);
  });

  it('falls back to "post" when a title slugs to nothing', () => {
    expect(contentBranchName('!!!', 'x1')).toBe('walkcroach/content/post-x1');
  });

  it('truncates a very long title', () => {
    const name = contentBranchName('a'.repeat(200), 'x1');
    expect(name.length).toBeLessThan(80);
  });
});

describe('openContentPullRequest', () => {
  const files = [{ path: 'src/content/post.tsx', content: 'export default () => null;' }];

  it('creates a branch and opens a PR against the default branch', async () => {
    const { calls } = fakeGithub();
    const res = await openContentPullRequest({
      token: 't',
      repo: 'acme/site',
      branch: 'walkcroach/content/x-1',
      files,
      title: 'Add post',
      body: 'generated',
    });

    expect(res).toMatchObject({
      number: 42,
      url: 'https://github.com/acme/site/pull/42',
      commitSha: 'new-commit',
    });

    const ref = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/refs'));
    expect(ref?.body).toMatchObject({ ref: 'refs/heads/walkcroach/content/x-1' });

    const pr = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'));
    expect(pr?.body).toMatchObject({ base: 'main', head: 'walkcroach/content/x-1' });
  });

  it('never pushes to the default branch', async () => {
    // The existing Web helper commits straight to main. For a CMS workflow that
    // would publish unreviewed content written by a non-technical author.
    const { calls } = fakeGithub();
    await openContentPullRequest({
      token: 't',
      repo: 'acme/site',
      branch: 'walkcroach/content/x-1',
      files,
      title: 'Add post',
      body: '',
    });
    const wroteToMain = calls.some(
      (c) => c.method === 'PATCH' && c.url.includes('/git/refs/heads/main'),
    );
    expect(wroteToMain).toBe(false);
  });

  it('puts all files in a single commit', async () => {
    const { calls } = fakeGithub();
    await openContentPullRequest({
      token: 't',
      repo: 'acme/site',
      branch: 'b',
      files: [
        { path: 'a.tsx', content: '1' },
        { path: 'b.tsx', content: '2' },
        { path: 'c.css', content: '3' },
      ],
      title: 'Add post',
      body: '',
    });
    const commits = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/git/commits'));
    expect(commits).toHaveLength(1);
    const tree = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/trees'));
    expect((tree?.body as { tree: unknown[] }).tree).toHaveLength(3);
  });

  it('honours a non-standard default branch', async () => {
    const { calls } = fakeGithub({
      'GET /repos/acme/site': { default_branch: 'trunk' },
      'GET /repos/acme/site/git/ref/heads/trunk': { object: { sha: 'base-sha' } },
    });
    await openContentPullRequest({
      token: 't',
      repo: 'acme/site',
      branch: 'b',
      files,
      title: 'x',
      body: '',
    });
    const pr = calls.find((c) => c.url.endsWith('/pulls'));
    expect(pr?.body).toMatchObject({ base: 'trunk' });
  });

  it('strips leading slashes from paths', async () => {
    const { calls } = fakeGithub();
    await openContentPullRequest({
      token: 't',
      repo: 'acme/site',
      branch: 'b',
      files: [{ path: '/src/x.tsx', content: 'x' }],
      title: 'x',
      body: '',
    });
    const tree = calls.find((c) => c.url.endsWith('/git/trees'));
    expect((tree?.body as { tree: Array<{ path: string }> }).tree[0]!.path).toBe('src/x.tsx');
  });

  it('refuses an empty pull request', async () => {
    fakeGithub();
    await expect(
      openContentPullRequest({
        token: 't',
        repo: 'acme/site',
        branch: 'b',
        files: [],
        title: 'x',
        body: '',
      }),
    ).rejects.toThrow(/no files/);
  });

  it('rejects a malformed repo string', async () => {
    fakeGithub();
    await expect(
      openContentPullRequest({
        token: 't',
        repo: 'not-a-repo',
        branch: 'b',
        files,
        title: 'x',
        body: '',
      }),
    ).rejects.toThrow(/owner\/name/);
  });

  it('surfaces a GitHub error with status and body', async () => {
    fakeGithub({
      'POST /repos/acme/site/pulls': new Response('branch already has a PR', { status: 422 }),
    });
    await expect(
      openContentPullRequest({
        token: 't',
        repo: 'acme/site',
        branch: 'b',
        files,
        title: 'x',
        body: '',
      }),
    ).rejects.toThrow(/422.*already has a PR/s);
  });
});

describe('readRepoContext', () => {
  const tree = {
    truncated: false,
    tree: [
      { path: 'package.json', type: 'blob', size: 500 },
      { path: 'tailwind.config.ts', type: 'blob', size: 400 },
      { path: 'src/components/Card.tsx', type: 'blob', size: 900 },
      { path: 'src/app/page.tsx', type: 'blob', size: 800 },
      { path: 'node_modules/react/index.js', type: 'blob', size: 100 },
      { path: 'dist/bundle.js', type: 'blob', size: 100 },
      { path: 'public/logo.png', type: 'blob', size: 100 },
      { path: 'README.md', type: 'blob', size: 100 },
      { path: 'src', type: 'tree' },
    ],
  };

  function ctxGithub() {
    return fakeGithub({
      'GET /repos/acme/site/git/trees/base-sha': tree,
      'GET /repos/acme/site/contents/package.json': { ok: true },
      'GET /repos/acme/site/contents/tailwind.config.ts': { ok: true },
      'GET /repos/acme/site/contents/src/components/Card.tsx': { ok: true },
      'GET /repos/acme/site/contents/src/app/page.tsx': { ok: true },
      'GET /repos/acme/site/contents/README.md': { ok: true },
    });
  }

  it('excludes node_modules, build output, and binaries', async () => {
    ctxGithub();
    const res = await readRepoContext({ token: 't', repo: 'acme/site' });
    const paths = res.files.map((f) => f.path);
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    expect(paths.some((p) => p.startsWith('dist/'))).toBe(false);
    expect(paths.some((p) => p.endsWith('.png'))).toBe(false);
  });

  it('ranks config and shared components above pages', async () => {
    // Conventions live in config and shared components. A page is an example of
    // the conventions, not a statement of them.
    ctxGithub();
    const res = await readRepoContext({ token: 't', repo: 'acme/site' });
    const paths = res.files.map((f) => f.path);
    expect(paths.indexOf('package.json')).toBeLessThan(paths.indexOf('src/app/page.tsx'));
    expect(paths.indexOf('tailwind.config.ts')).toBeLessThan(
      paths.indexOf('src/app/page.tsx'),
    );
  });

  it('promotes caller-supplied path hints above everything else', async () => {
    ctxGithub();
    const res = await readRepoContext({
      token: 't',
      repo: 'acme/site',
      pathHints: ['src/app'],
    });
    expect(res.files[0]!.path).toBe('src/app/page.tsx');
  });

  it('reads AGENTS.md, which the scoring function used to drop entirely', async () => {
    // Regression: AGENTS.md matched no name, directory, or extension rule, so it
    // scored 0 and was filtered out. The whole AGENTS.md feature was dead in
    // production while its own unit tests passed on hand-built fixtures.
    fakeGithub({
      'GET /repos/acme/site/git/trees/base-sha': {
        truncated: false,
        tree: [
          { path: 'AGENTS.md', type: 'blob', size: 800 },
          { path: 'packages/web/AGENTS.md', type: 'blob', size: 400 },
          { path: 'package.json', type: 'blob', size: 500 },
        ],
      },
      'GET /repos/acme/site/contents/AGENTS.md': { ok: true },
      'GET /repos/acme/site/contents/packages/web/AGENTS.md': { ok: true },
      'GET /repos/acme/site/contents/package.json': { ok: true },
    });

    const res = await readRepoContext({ token: 't', repo: 'acme/site' });
    const paths = res.files.map((f) => f.path);
    expect(paths).toContain('AGENTS.md');
    expect(paths).toContain('packages/web/AGENTS.md');
  });

  it('ranks AGENTS.md above everything, including caller hints', async () => {
    // It is the repo stating its own rules, which beats anything we infer.
    fakeGithub({
      'GET /repos/acme/site/git/trees/base-sha': {
        truncated: false,
        tree: [
          { path: 'package.json', type: 'blob', size: 500 },
          { path: 'AGENTS.md', type: 'blob', size: 800 },
          { path: 'src/app/page.tsx', type: 'blob', size: 300 },
        ],
      },
      'GET /repos/acme/site/contents/AGENTS.md': { ok: true },
      'GET /repos/acme/site/contents/package.json': { ok: true },
      'GET /repos/acme/site/contents/src/app/page.tsx': { ok: true },
    });

    const res = await readRepoContext({
      token: 't',
      repo: 'acme/site',
      pathHints: ['src/app'],
    });
    expect(res.files[0]!.path).toBe('AGENTS.md');
  });

  it('caps the number of files read', async () => {
    ctxGithub();
    const res = await readRepoContext({ token: 't', repo: 'acme/site', maxFiles: 2 });
    expect(res.files).toHaveLength(2);
    expect(res.truncated).toBe(true);
  });
});
