import { randomUUID } from 'node:crypto';
import { zipSync } from 'fflate';
import type { DbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import {
  checkpointStorageKey,
  contentHash,
  exportStorageKey,
  fileStorageKey,
  getObject,
  getPresignedGetUrl,
  putObject,
  readSnapshot,
  writeSnapshot,
  type ProjectSnapshot,
  type SnapshotFile,
} from '../artefacts.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

type ProjectRow = { id: string; owner_id: string };

export async function assertProjectOwner(
  db: DbClient,
  projectId: string,
  auth: AuthContext,
): Promise<ProjectRow | null> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT id, owner_id FROM projects
     WHERE id = $1::uuid AND deleted_at IS NULL`,
    [projectId],
  );
  const row = rows[0];
  if (!row || row.owner_id !== auth.ownerId) return null;
  return row;
}

async function upsertProjectFiles(
  db: DbClient,
  projectId: string,
  files: SnapshotFile[],
): Promise<void> {
  for (const file of files) {
    const hash = contentHash(file.content);
    const storageKey = fileStorageKey(projectId, file.path);
    await putObject(storageKey, file.content);
    await db.query(
      `INSERT INTO project_files (project_id, path, content_hash, storage_key, updated_at)
       VALUES ($1::uuid, $2, $3, $4, now())
       ON CONFLICT (project_id, path) DO UPDATE SET
         content_hash = EXCLUDED.content_hash,
         storage_key = EXCLUDED.storage_key,
         updated_at = now()`,
      [projectId, file.path, hash, storageKey],
    );
  }
  await db.query(
    `UPDATE projects SET updated_at = now() WHERE id = $1::uuid`,
    [projectId],
  );
}

export async function loadProjectFilesForDeploy(
  db: DbClient,
  projectId: string,
): Promise<SnapshotFile[]> {
  return loadProjectFiles(db, projectId);
}

async function loadProjectFiles(
  db: DbClient,
  projectId: string,
): Promise<SnapshotFile[]> {
  const { rows } = await db.query<{ path: string; storage_key: string }>(
    `SELECT path, storage_key FROM project_files WHERE project_id = $1::uuid`,
    [projectId],
  );
  const files: SnapshotFile[] = [];
  for (const row of rows) {
    const buf = await getObject(row.storage_key);
    files.push({ path: row.path, content: buf.toString('utf8') });
  }
  return files;
}

type CheckpointRow = {
  id: string;
  project_id: string;
  session_id: string | null;
  name: string | null;
  summary: string;
  storage_key: string;
  created_at: Date;
};

function mapCheckpoint(row: CheckpointRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    name: row.name,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
  };
}

export async function handleSyncFiles(
  db: DbClient,
  projectId: string,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const body = JSON.parse(rawBody ?? '{}') as {
    files?: SnapshotFile[];
  };
  if (!body.files?.length) {
    return jsonResponse(400, { error: 'files array required' });
  }

  const filtered = body.files.filter(
    (f) =>
      f.path &&
      !f.path.includes('node_modules/') &&
      !f.path.startsWith('node_modules/'),
  );
  await upsertProjectFiles(db, projectId, filtered);
  return jsonResponse(200, { ok: true, synced: filtered.length });
}

export async function handleListCheckpoints(
  db: DbClient,
  projectId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const { rows } = await db.query<CheckpointRow>(
    `SELECT id, project_id, session_id, name, summary, storage_key, created_at
     FROM checkpoints
     WHERE project_id = $1::uuid AND superseded_by IS NULL
     ORDER BY created_at DESC
     LIMIT 50`,
    [projectId],
  );
  return jsonResponse(200, { checkpoints: rows.map(mapCheckpoint) });
}

export async function handleCreateCheckpoint(
  db: DbClient,
  projectId: string,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const body = JSON.parse(rawBody ?? '{}') as {
    name?: string;
    summary?: string;
    sessionId?: string;
    auto?: boolean;
    files?: SnapshotFile[];
  };

  if (body.files?.length) {
    await upsertProjectFiles(db, projectId, body.files);
  }

  const snapshotFiles = body.files?.length
    ? body.files
    : await loadProjectFiles(db, projectId);

  if (snapshotFiles.length === 0) {
    return jsonResponse(400, { error: 'no files to checkpoint — sync first' });
  }

  const checkpointId = randomUUID();
  const storageKey = checkpointStorageKey(projectId, checkpointId);
  const summary =
    body.summary?.trim() ||
    (body.auto ? 'Auto checkpoint after build turn' : 'Manual checkpoint');

  const snapshot: ProjectSnapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    files: snapshotFiles,
  };
  await writeSnapshot(storageKey, snapshot);

  await db.query(
    `INSERT INTO checkpoints (id, project_id, session_id, name, summary, storage_key)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
    [
      checkpointId,
      projectId,
      body.sessionId ?? null,
      body.name?.trim() || null,
      summary,
      storageKey,
    ],
  );

  return jsonResponse(201, {
    checkpointId,
    summary,
    fileCount: snapshotFiles.length,
  });
}

export async function handleRevertCheckpoint(
  db: DbClient,
  checkpointId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const { rows } = await db.query<CheckpointRow & { owner_id: string }>(
    `SELECT c.id, c.project_id, c.session_id, c.name, c.summary, c.storage_key, c.created_at, p.owner_id
     FROM checkpoints c
     JOIN projects p ON p.id = c.project_id
     WHERE c.id = $1::uuid AND p.deleted_at IS NULL`,
    [checkpointId],
  );
  const row = rows[0];
  if (!row || row.owner_id !== auth.ownerId) {
    return jsonResponse(404, { error: 'checkpoint not found' });
  }

  const snapshot = await readSnapshot(row.storage_key);
  await upsertProjectFiles(db, row.project_id, snapshot.files);

  return jsonResponse(200, {
    checkpointId: row.id,
    projectId: row.project_id,
    files: snapshot.files,
  });
}

export async function handleExportProject(
  db: DbClient,
  projectId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const files = await loadProjectFiles(db, projectId);
  if (files.length === 0) {
    return jsonResponse(400, { error: 'no files to export — sync first' });
  }

  const zipEntries: Record<string, Uint8Array> = {};
  for (const f of files) {
    zipEntries[f.path] = new TextEncoder().encode(f.content);
  }
  const zipBytes = zipSync(zipEntries);
  const exportId = randomUUID();
  const key = exportStorageKey(projectId, exportId);
  await putObject(key, Buffer.from(zipBytes));

  const url = await getPresignedGetUrl(key);
  return jsonResponse(200, {
    url,
    exportId,
    fileCount: files.length,
    expiresIn: 900,
  });
}
