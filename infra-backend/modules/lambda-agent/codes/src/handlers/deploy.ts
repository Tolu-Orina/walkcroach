import { randomUUID } from 'node:crypto';
import {
  CodeBuildClient,
  StartBuildCommand,
} from '@aws-sdk/client-codebuild';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { zipSync } from 'fflate';
import type { DbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { putObject } from '../artefacts.js';
import { jsonResponse } from '../http.js';
import { assertCredits, debitCredits } from './billing.js';
import {
  assertProjectOwner,
  loadProjectFilesForDeploy,
} from './projectArtifacts.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

function slugify(name: string, projectId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const suffix = projectId.replace(/-/g, '').slice(0, 6);
  return `${base || 'app'}-${suffix}`;
}

function deployUrl(slug: string): string {
  const wildcard = process.env.APPS_WILDCARD_DOMAIN;
  if (wildcard) return `https://${slug}.${wildcard}`;
  const cf = process.env.APPS_CF_DOMAIN;
  if (cf) return `https://${cf}/${slug}/live/`;
  return `http://localhost:5173`;
}

function deploySourceKey(deploymentId: string): string {
  return `deploy-sources/${deploymentId}.zip`;
}

async function ensureDeploySlug(
  db: DbClient,
  projectId: string,
  projectName: string,
): Promise<string> {
  const { rows } = await db.query<{ deploy_slug: string | null; name: string }>(
    `SELECT deploy_slug, name FROM projects WHERE id = $1::uuid`,
    [projectId],
  );
  const row = rows[0];
  if (!row) throw new Error('project not found');
  if (row.deploy_slug) return row.deploy_slug;

  let slug = slugify(projectName || row.name, projectId);
  const { rows: taken } = await db.query<{ deploy_slug: string }>(
    `SELECT deploy_slug FROM projects WHERE deploy_slug = $1 AND id != $2::uuid LIMIT 1`,
    [slug, projectId],
  );
  if (taken[0]) {
    slug = `${slug}-${randomUUID().slice(0, 4)}`;
  }

  await db.query(
    `UPDATE projects SET deploy_slug = $2, updated_at = now() WHERE id = $1::uuid`,
    [projectId, slug],
  );
  return slug;
}

async function packageProjectZip(
  files: Array<{ path: string; content: string }>,
): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    const path = file.path.replace(/^\/+/, '');
    if (!path || path.includes('node_modules/')) continue;
    entries[path] = new TextEncoder().encode(file.content);
  }
  return zipSync(entries);
}

async function startCodeBuild(params: {
  deploymentId: string;
  slug: string;
  sourceKey: string;
}): Promise<string | null> {
  const project = process.env.CODEBUILD_PROJECT;
  const appsBucket = process.env.APPS_BUCKET;
  const artefactsBucket = process.env.ARTEFACTS_BUCKET;
  if (!project || !appsBucket || !artefactsBucket) return null;

  const client = new CodeBuildClient({
    region: process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? 'eu-west-2',
  });

  const res = await client.send(
    new StartBuildCommand({
      projectName: project,
      environmentVariablesOverride: [
        { name: 'DEPLOYMENT_ID', value: params.deploymentId, type: 'PLAINTEXT' },
        { name: 'DEPLOY_SLUG', value: params.slug, type: 'PLAINTEXT' },
        { name: 'SOURCE_BUCKET', value: artefactsBucket, type: 'PLAINTEXT' },
        { name: 'SOURCE_KEY', value: params.sourceKey, type: 'PLAINTEXT' },
        { name: 'APPS_BUCKET', value: appsBucket, type: 'PLAINTEXT' },
        {
          name: 'APPS_WILDCARD_DOMAIN',
          value: process.env.APPS_WILDCARD_DOMAIN ?? '',
          type: 'PLAINTEXT',
        },
        {
          name: 'APPS_CF_DOMAIN',
          value: process.env.APPS_CF_DOMAIN ?? '',
          type: 'PLAINTEXT',
        },
      ],
    }),
  );

  return res.build?.id ?? null;
}

async function refreshPendingDeployments(
  db: DbClient,
  projectId: string,
): Promise<void> {
  const appsBucket = process.env.APPS_BUCKET;
  if (!appsBucket) return;

  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM deployments
     WHERE project_id = $1::uuid AND status IN ('building', 'queued_local')
     ORDER BY deployed_at DESC
     LIMIT 10`,
    [projectId],
  );
  if (rows.length === 0) return;

  const s3 = new S3Client({
    region: process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? 'eu-west-2',
  });

  for (const row of rows) {
    try {
      await s3.send(
        new GetObjectCommand({
          Bucket: appsBucket,
          Key: `_deployments/${row.id}.json`,
        }),
      );
      await db.query(
        `UPDATE deployments SET status = 'live' WHERE id = $1::uuid`,
        [row.id],
      );
    } catch {
      // still building
    }
  }
}

export async function handleTriggerDeploy(
  db: DbClient,
  projectId: string,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const credits = await assertCredits(db, auth.ownerId, 'deploy');
  if (!credits.ok) {
    return jsonResponse(402, {
      error: 'insufficient credits',
      remaining: credits.remaining,
    });
  }

  const body = JSON.parse(rawBody ?? '{}') as {
    files?: Array<{ path: string; content: string }>;
    projectName?: string;
  };

  const files =
    body.files?.length ? body.files : await loadProjectFilesForDeploy(db, projectId);
  if (files.length === 0) {
    return jsonResponse(400, {
      error: 'no project files to deploy — sync or build in preview first',
    });
  }

  // Debit before packaging/build so concurrent requests cannot overspend.
  const usage = await debitCredits(db, auth.ownerId, 'deploy', projectId, {});
  if (!usage.ok) {
    return jsonResponse(402, {
      error: 'insufficient credits',
      remaining: usage.remaining,
    });
  }

  const { rows: meta } = await db.query<{ name: string }>(
    `SELECT name FROM projects WHERE id = $1::uuid`,
    [projectId],
  );
  const slug = await ensureDeploySlug(
    db,
    projectId,
    body.projectName ?? meta[0]?.name ?? 'app',
  );

  const deploymentId = randomUUID();
  const sourceKey = deploySourceKey(deploymentId);
  const zip = await packageProjectZip(files);
  await putObject(sourceKey, Buffer.from(zip));

  const buildId = await startCodeBuild({ deploymentId, slug, sourceKey });
  const url = deployUrl(slug);
  const status = buildId ? 'building' : 'queued_local';

  await db.query(
    `INSERT INTO deployments (id, project_id, target, url, status, build_id, live_prefix)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
    [
      deploymentId,
      projectId,
      's3_cloudfront',
      url,
      status,
      buildId,
      `${slug}/live`,
    ],
  );

  await db.query(
    `UPDATE projects SET status = 'deployed', updated_at = now() WHERE id = $1::uuid`,
    [projectId],
  );

  return jsonResponse(202, {
    deploymentId,
    slug,
    url,
    status,
    buildId,
    remainingCredits: usage.remaining,
  });
}

export async function handleListDeployments(
  db: DbClient,
  projectId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  await refreshPendingDeployments(db, projectId);

  const { rows } = await db.query<{
    id: string;
    target: string;
    url: string | null;
    status: string;
    build_id: string | null;
    error_message: string | null;
    deployed_at: Date;
  }>(
    `SELECT id, target, url, status, build_id, error_message, deployed_at
     FROM deployments
     WHERE project_id = $1::uuid
     ORDER BY deployed_at DESC
     LIMIT 30`,
    [projectId],
  );

  return jsonResponse(200, {
    deployments: rows.map((row) => ({
      id: row.id,
      target: row.target,
      url: row.url,
      status: row.status,
      buildId: row.build_id,
      errorMessage: row.error_message,
      deployedAt: row.deployed_at.toISOString(),
    })),
  });
}
