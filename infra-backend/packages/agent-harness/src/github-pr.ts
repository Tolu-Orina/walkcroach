/**
 * GitHub App access and pull-request creation for SDK content publishing.
 *
 * **Why this is not `lambda-agent/src/handlers/github.ts`.** That module's
 * `pushFilesToRepo` commits straight to `main`/`master`. For the Web builder,
 * where the person driving the agent owns the repo and is watching it happen,
 * that is a defensible default. For a CMS workflow it is exactly wrong: a
 * non-technical author uploads a document and something lands on the default
 * branch with no review. This module opens a branch and a pull request instead,
 * so the existing human review gate — and the repo's own CI — do the verifying.
 *
 * **On the duplicated app-JWT logic.** `createGithubAppJwt` and
 * `getInstallationAccessToken` mirror `lambda-agent/src/github-app.ts` rather
 * than importing it, because that module lives inside a deployed Lambda bundle
 * that Web is pinned to. Moving it into a shared package is the right end state
 * and the wrong change to make two weeks before a deadline. Deliberate debt:
 * collapse these once Web is not on the critical path.
 */
import { createSign } from 'node:crypto';
import { isAgentsFile } from './agents-md.js';

const GITHUB_API = 'https://api.github.com';

export type RepoFile = { path: string; content: string };

function base64Url(input: string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function createGithubAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    // 60s of backdating absorbs clock skew between us and GitHub; 10 minutes is
    // the maximum GitHub accepts for an app JWT.
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer
    .sign(privateKeyPem, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
}

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  // 60s of headroom: a token that expires mid-request is indistinguishable from
  // a permissions problem in the logs.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const appId = process.env.GITHUB_APP_ID;
  const key = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !key) {
    throw new Error(
      'GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required to publish to GitHub',
    );
  }

  const jwt = createGithubAppJwt(appId, key.replace(/\\n/g, '\n'));
  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    },
  );
  if (!res.ok) {
    throw new Error(`github installation token failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string; expires_at: string };
  tokenCache.set(installationId, {
    token: body.token,
    expiresAt: new Date(body.expires_at).getTime(),
  });
  return body.token;
}

async function gh(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function ghJson<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await gh(token, path, init);
  if (!res.ok) {
    throw new Error(`GitHub ${init?.method ?? 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error('repo must be in owner/name form');
  return { owner, name };
}

/** Resolve the repo's actual default branch rather than guessing main vs master. */
export async function getDefaultBranch(token: string, repo: string): Promise<string> {
  const { owner, name } = splitRepo(repo);
  const info = await ghJson<{ default_branch: string }>(
    token,
    `/repos/${owner}/${name}`,
  );
  return info.default_branch;
}

/**
 * Branch name for a publish run.
 *
 * Slugged and suffixed rather than reused: two authors publishing posts with the
 * same title on the same day must not collide onto one branch, which would make
 * the second PR silently contain the first one's changes.
 */
export function contentBranchName(title: string, suffix: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'post';
  return `walkcroach/content/${slug}-${suffix}`;
}

export type PullRequestResult = {
  number: number;
  url: string;
  branch: string;
  commitSha: string;
};

/**
 * Commit `files` onto a new branch and open a pull request.
 *
 * Uses the git data API (blob-free tree with inline content) rather than the
 * contents API, so all files land in a single commit. The contents API is one
 * commit per file, which would turn a five-file post into a five-commit PR.
 */
export async function openContentPullRequest(params: {
  token: string;
  repo: string;
  branch: string;
  files: RepoFile[];
  title: string;
  body: string;
  baseBranch?: string;
}): Promise<PullRequestResult> {
  const { owner, name } = splitRepo(params.repo);
  const base = params.baseBranch ?? (await getDefaultBranch(params.token, params.repo));

  if (params.files.length === 0) {
    throw new Error('refusing to open a pull request with no files');
  }

  const baseRef = await ghJson<{ object: { sha: string } }>(
    params.token,
    `/repos/${owner}/${name}/git/ref/heads/${base}`,
  );
  const baseSha = baseRef.object.sha;

  const baseCommit = await ghJson<{ tree: { sha: string } }>(
    params.token,
    `/repos/${owner}/${name}/git/commits/${baseSha}`,
  );

  const tree = await ghJson<{ sha: string }>(
    params.token,
    `/repos/${owner}/${name}/git/trees`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: params.files.map((f) => ({
          path: f.path.replace(/^\/+/, ''),
          mode: '100644',
          type: 'blob',
          content: f.content,
        })),
      }),
    },
  );

  const commit = await ghJson<{ sha: string }>(
    params.token,
    `/repos/${owner}/${name}/git/commits`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: params.title,
        tree: tree.sha,
        parents: [baseSha],
      }),
    },
  );

  await ghJson(params.token, `/repos/${owner}/${name}/git/refs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${params.branch}`, sha: commit.sha }),
  });

  const pr = await ghJson<{ number: number; html_url: string }>(
    params.token,
    `/repos/${owner}/${name}/pulls`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        head: params.branch,
        base,
        body: params.body,
      }),
    },
  );

  return {
    number: pr.number,
    url: pr.html_url,
    branch: params.branch,
    commitSha: commit.sha,
  };
}

const SKIP_PATH = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage)(\/|$)/i;
const SKIP_EXT =
  /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|mp3|zip|gz|wasm|pdf|lock)$/i;

/**
 * Read enough of the target repo to write code that matches it.
 *
 * This is the "gather" half of gather→act→verify pointed at someone else's
 * codebase. Generating a component without it produces something that compiles
 * and looks foreign — the wrong import alias, the wrong class-name helper, a
 * bespoke card next to the design system's own.
 *
 * Capped hard: the point is to infer conventions, not to load the repo into
 * context. Config and component files are prioritised because that is where
 * conventions actually live.
 */
export async function readRepoContext(params: {
  token: string;
  repo: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  pathHints?: string[];
}): Promise<{ files: RepoFile[]; truncated: boolean; totalPaths: number }> {
  const { owner, name } = splitRepo(params.repo);
  const maxFiles = params.maxFiles ?? 40;
  const maxBytes = params.maxBytesPerFile ?? 24_000;

  const base = await getDefaultBranch(params.token, params.repo);
  const ref = await ghJson<{ object: { sha: string } }>(
    params.token,
    `/repos/${owner}/${name}/git/ref/heads/${base}`,
  );
  const tree = await ghJson<{
    tree: Array<{ path: string; type: string; size?: number }>;
    truncated: boolean;
  }>(params.token, `/repos/${owner}/${name}/git/trees/${ref.object.sha}?recursive=1`);

  const candidates = tree.tree.filter(
    (n) =>
      n.type === 'blob' &&
      !SKIP_PATH.test(n.path) &&
      !SKIP_EXT.test(n.path) &&
      (n.size ?? 0) <= maxBytes,
  );

  const hints = params.pathHints ?? [];
  const score = (p: string): number => {
    let s = 0;
    if (hints.some((h) => p.startsWith(h))) s += 100;
    // Conventions live in config and shared components far more than in pages.
    if (/^(package\.json|tsconfig.*\.json|tailwind\.config\.|components\.json)/.test(p)) s += 60;
    if (/(^|\/)(components|ui|lib|styles)\//.test(p)) s += 30;
    if (/\.(tsx|ts|css|mdx)$/.test(p)) s += 10;
    if (/(^|\/)(app|pages|src)\//.test(p)) s += 5;
    return s;
  };

  /**
   * `AGENTS.md` outranks everything, including caller hints.
   *
   * It is the repository telling agents its own rules, which beats any
   * convention we could infer from its code. It scored zero before — no name
   * match, no directory match, and `.md` is not in the extension list — so it
   * was dropped by the `s > 0` filter below and the whole AGENTS.md path was
   * dead in production while its unit tests passed on hand-built fixtures.
   */
  const rank = (p: string): number => (isAgentsFile(p) ? 500 : score(p));

  const picked = candidates
    .map((n) => ({ n, s: rank(n.path) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.n.path.localeCompare(b.n.path))
    .slice(0, maxFiles)
    .map((x) => x.n);

  const files: RepoFile[] = [];
  for (const node of picked) {
    const res = await gh(
      params.token,
      `/repos/${owner}/${name}/contents/${encodeURI(node.path)}?ref=${base}`,
      { headers: { accept: 'application/vnd.github.raw' } },
    );
    if (!res.ok) continue;
    files.push({ path: node.path, content: (await res.text()).slice(0, maxBytes) });
  }

  return {
    files,
    truncated: tree.truncated || candidates.length > picked.length,
    totalPaths: tree.tree.length,
  };
}
