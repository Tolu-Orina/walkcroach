import type { DbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { getInstallationAccessToken } from '../github-app.js';
import { getGithubAppConfig, isGithubAppEnabled } from '../github-config.js';
import {
  consumeGithubOAuthState,
  createGithubOAuthState,
} from '../github-oauth.js';
import { getProjectSecret, putProjectSecret } from '../project-secrets.js';
import { loadProjectFilesForDeploy, assertProjectOwner } from './projectArtifacts.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

type SnapshotFile = { path: string; content: string };

type ProjectGithubRow = {
  github_repo: string | null;
  github_installation_id: number | null;
};

function patConnectAllowed(): boolean {
  return process.env.ALLOW_GITHUB_PAT !== 'false';
}

async function githubRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function pushFilesToRepo(
  token: string,
  repo: string,
  files: SnapshotFile[],
  message: string,
): Promise<void> {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error('repo must be owner/name');

  const refRes = await githubRequest(token, `/repos/${owner}/${name}/git/ref/heads/main`);
  let refSha: string;
  if (refRes.status === 404) {
    const masterRes = await githubRequest(
      token,
      `/repos/${owner}/${name}/git/ref/heads/master`,
    );
    if (!masterRes.ok) {
      throw new Error('repository needs an initial main or master branch');
    }
    refSha = ((await masterRes.json()) as { object: { sha: string } }).object.sha;
  } else if (!refRes.ok) {
    throw new Error(await refRes.text());
  } else {
    refSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;
  }

  const commitRes = await githubRequest(
    token,
    `/repos/${owner}/${name}/git/commits/${refSha}`,
  );
  if (!commitRes.ok) throw new Error(await commitRes.text());
  const baseTree = ((await commitRes.json()) as { tree: { sha: string } }).tree.sha;

  const tree = files
    .filter((f) => f.path && !f.path.includes('node_modules/'))
    .map((f) => ({
      path: f.path.replace(/^\/+/, ''),
      mode: '100644' as const,
      type: 'blob' as const,
      content: f.content,
    }));

  const treeRes = await githubRequest(token, `/repos/${owner}/${name}/git/trees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });
  if (!treeRes.ok) throw new Error(await treeRes.text());
  const treeSha = ((await treeRes.json()) as { sha: string }).sha;

  const newCommitRes = await githubRequest(
    token,
    `/repos/${owner}/${name}/git/commits`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [refSha],
      }),
    },
  );
  if (!newCommitRes.ok) throw new Error(await newCommitRes.text());
  const commitSha = ((await newCommitRes.json()) as { sha: string }).sha;

  const branch = refRes.status === 404 ? 'master' : 'main';
  const updateRef = await githubRequest(
    token,
    `/repos/${owner}/${name}/git/refs/heads/${branch}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha: commitSha }),
    },
  );
  if (!updateRef.ok) throw new Error(await updateRef.text());
}

async function loadProjectGithub(
  db: DbClient,
  projectId: string,
): Promise<ProjectGithubRow | null> {
  const { rows } = await db.query<ProjectGithubRow>(
    `SELECT github_repo, github_installation_id
     FROM projects WHERE id = $1::uuid`,
    [projectId],
  );
  return rows[0] ?? null;
}

async function resolveGithubPushToken(
  db: DbClient,
  projectId: string,
  row: ProjectGithubRow,
): Promise<string> {
  if (row.github_installation_id) {
    return getInstallationAccessToken(row.github_installation_id);
  }
  const pat = await getProjectSecret(projectId, 'GITHUB_TOKEN');
  if (!pat) {
    throw new Error('GitHub is not connected for this project');
  }
  return pat;
}

export async function handleGithubConnect(
  db: DbClient,
  projectId: string,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const body = JSON.parse(rawBody ?? '{}') as { repo?: string; token?: string };
  const repo = body.repo?.trim();
  const token = body.token?.trim();

  if (token) {
    if (!patConnectAllowed()) {
      return jsonResponse(400, { error: 'PAT connect disabled — use GitHub App' });
    }
    if (!repo || !token) {
      return jsonResponse(400, { error: 'repo and token required' });
    }
    await putProjectSecret(projectId, 'GITHUB_TOKEN', token);
    await db.query(
      `UPDATE projects
       SET github_repo = $2, github_installation_id = NULL, updated_at = now()
       WHERE id = $1::uuid`,
      [projectId, repo],
    );
    return jsonResponse(200, { ok: true, repo, authMethod: 'pat' });
  }

  if (!(await isGithubAppEnabled())) {
    return jsonResponse(503, {
      error: 'GitHub App not configured — provide a PAT or configure SSM parameters',
    });
  }

  if (!repo) {
    return jsonResponse(400, { error: 'repo required' });
  }

  const config = await getGithubAppConfig();
  if (!config) {
    return jsonResponse(503, { error: 'GitHub App not configured' });
  }

  const state = await createGithubOAuthState(db, projectId, auth.ownerId, repo);
  const installUrl = `https://github.com/apps/${config.appSlug}/installations/new?state=${encodeURIComponent(state)}`;

  return jsonResponse(200, {
    ok: true,
    installUrl,
    authMethod: 'app',
    repo,
  });
}

export async function handleGithubInstallCallback(
  db: DbClient,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const body = JSON.parse(rawBody ?? '{}') as {
    installation_id?: number;
    state?: string;
  };

  const installationId = Number(body.installation_id);
  const state = body.state?.trim();

  if (!installationId || !Number.isFinite(installationId) || !state) {
    return jsonResponse(400, { error: 'installation_id and state required' });
  }

  try {
    const { projectId, repo } = await consumeGithubOAuthState(db, state, auth.ownerId);
    const project = await assertProjectOwner(db, projectId, auth);
    if (!project) {
      return jsonResponse(404, { error: 'project not found' });
    }

    await db.query(
      `UPDATE projects
       SET github_repo = $2,
           github_installation_id = $3,
           updated_at = now()
       WHERE id = $1::uuid`,
      [projectId, repo, installationId],
    );

    return jsonResponse(200, {
      ok: true,
      projectId,
      repo,
      installationId,
      authMethod: 'app',
    });
  } catch (err) {
    return jsonResponse(400, {
      error: err instanceof Error ? err.message : 'invalid oauth state',
    });
  }
}

export async function handleGithubPush(
  db: DbClient,
  projectId: string,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const body = JSON.parse(rawBody ?? '{}') as {
    message?: string;
    files?: SnapshotFile[];
  };

  const gh = await loadProjectGithub(db, projectId);
  if (!gh?.github_repo) {
    return jsonResponse(400, { error: 'connect GitHub repo first' });
  }
  const repo = gh.github_repo;

  let token: string;
  try {
    token = await resolveGithubPushToken(db, projectId, gh);
  } catch (err) {
    return jsonResponse(400, {
      error: err instanceof Error ? err.message : 'GitHub not connected',
    });
  }

  const files =
    body.files?.length ? body.files : await loadProjectFilesForDeploy(db, projectId);
  if (files.length === 0) {
    return jsonResponse(400, { error: 'no files to push' });
  }

  const message = body.message?.trim() || 'WalkCroach sync';
  await pushFilesToRepo(token, repo, files, message);

  return jsonResponse(200, { ok: true, repo, fileCount: files.length });
}

export async function handleGithubStatus(
  db: DbClient,
  projectId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const gh = await loadProjectGithub(db, projectId);
  const hasPat = Boolean(await getProjectSecret(projectId, 'GITHUB_TOKEN'));
  const hasInstallation = Boolean(gh?.github_installation_id);
  const authMethod = hasInstallation ? 'app' : hasPat ? 'pat' : null;

  return jsonResponse(200, {
    connected: Boolean(gh?.github_repo && authMethod),
    repo: gh?.github_repo ?? null,
    authMethod,
    appEnabled: await isGithubAppEnabled(),
    patAllowed: patConnectAllowed(),
  });
}
