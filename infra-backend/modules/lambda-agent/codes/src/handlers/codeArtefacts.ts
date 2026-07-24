/**
 * Code artefacts library (Phase E CD-10 / CD-11 / CD-12).
 */
import { createHash } from 'node:crypto';
import type { DbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

type ArtefactRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  session_id: string | null;
  path: string;
  language: string | null;
  content_hash: string | null;
  s3_key: string | null;
  content: string | null;
  created_at: Date;
  updated_at: Date;
  project_name?: string | null;
};

const SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|css|scss|html?|mdx?|json|vue|svelte|py|go|rs|sql|yml|yaml|toml|sh|svg)$/i;

const SKIP_PATH =
  /(^|\/)(node_modules|dist|build|\.git|coverage)(\/|$)|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/i;

export function isLibrarySourcePath(path: string): boolean {
  if (!path || SKIP_PATH.test(path)) return false;
  return SOURCE_EXT.test(path);
}

export function languageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    css: 'css',
    scss: 'scss',
    html: 'html',
    htm: 'html',
    md: 'markdown',
    mdx: 'markdown',
    json: 'json',
    vue: 'vue',
    svelte: 'svelte',
    py: 'python',
    go: 'go',
    rs: 'rust',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sh: 'shell',
    svg: 'xml',
  };
  return map[ext] ?? 'plaintext';
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

function mapArtefact(row: ArtefactRow, includeContent = false) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name ?? null,
    sessionId: row.session_id,
    path: row.path,
    language: row.language,
    contentHash: row.content_hash,
    s3Key: row.s3_key,
    content: includeContent ? row.content : undefined,
    byteSize: row.content ? Buffer.byteLength(row.content, 'utf8') : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    source: row.path.startsWith('chat/')
      ? 'chat'
      : row.project_id
        ? 'builder'
        : 'chat',
  };
}

/** Upsert builder-synced source files into the code library. */
export async function upsertCodeArtefactsFromFiles(
  db: DbClient,
  userId: string,
  projectId: string,
  files: Array<{ path: string; content: string; storageKey?: string }>,
  sessionId?: string | null,
): Promise<number> {
  let count = 0;
  for (const file of files) {
    if (!isLibrarySourcePath(file.path)) continue;
    const hash = hashContent(file.content);
    const language = languageFromPath(file.path);
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM code_artefacts
       WHERE user_id = $1 AND project_id = $2::uuid AND path = $3
       LIMIT 1`,
      [userId, projectId, file.path],
    );
    if (rows[0]) {
      await db.query(
        `UPDATE code_artefacts SET
           content = $2,
           content_hash = $3,
           language = $4,
           s3_key = COALESCE($5, s3_key),
           session_id = COALESCE($6::uuid, session_id),
           updated_at = now()
         WHERE id = $1::uuid`,
        [
          rows[0].id,
          file.content,
          hash,
          language,
          file.storageKey ?? null,
          sessionId ?? null,
        ],
      );
    } else {
      await db.query(
        `INSERT INTO code_artefacts
           (user_id, project_id, session_id, path, language, content_hash, s3_key, content)
         VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)`,
        [
          userId,
          projectId,
          sessionId ?? null,
          file.path,
          language,
          hash,
          file.storageKey ?? null,
          file.content,
        ],
      );
    }
    count += 1;
  }
  return count;
}

export async function handleListCodeArtefacts(
  db: DbClient,
  auth: AuthContext,
  query: { projectId?: string; limit?: number } = {},
): Promise<RestResult> {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 200);
  const params: unknown[] = [auth.ownerId];
  let where = 'a.user_id = $1';
  if (query.projectId) {
    params.push(query.projectId);
    where += ` AND a.project_id = $${params.length}::uuid`;
  }
  params.push(limit);
  const { rows } = await db.query<ArtefactRow>(
    `SELECT a.id, a.user_id, a.project_id, a.session_id, a.path, a.language,
            a.content_hash, a.s3_key, a.created_at, a.updated_at, p.name AS project_name
     FROM code_artefacts a
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE ${where}
     ORDER BY a.updated_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return jsonResponse(200, {
    artefacts: rows.map((r) => mapArtefact({ ...r, content: null }, false)),
  });
}

export async function handleGetCodeArtefact(
  db: DbClient,
  artefactId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const { rows } = await db.query<ArtefactRow>(
    `SELECT a.id, a.user_id, a.project_id, a.session_id, a.path, a.language,
            a.content_hash, a.s3_key, a.content, a.created_at, a.updated_at,
            p.name AS project_name
     FROM code_artefacts a
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE a.id = $1::uuid AND a.user_id = $2
     LIMIT 1`,
    [artefactId, auth.ownerId],
  );
  const row = rows[0];
  if (!row) return jsonResponse(404, { error: 'artefact not found' });
  return jsonResponse(200, { artefact: mapArtefact(row, true) });
}

export async function handleCreateCodeArtefact(
  db: DbClient,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const body = JSON.parse(rawBody ?? '{}') as {
    path?: string;
    content?: string;
    language?: string;
    projectId?: string | null;
    sessionId?: string | null;
  };
  const content = body.content ?? '';
  let path = (body.path ?? '').trim();
  if (!content.trim()) {
    return jsonResponse(400, { error: 'content required' });
  }
  if (content.trim().length < 40 && content.split('\n').length < 3) {
    return jsonResponse(400, {
      error: 'code block too small — save substantial snippets only',
    });
  }
  if (!path) {
    const lang = body.language || 'txt';
    const ext =
      lang === 'typescript'
        ? 'ts'
        : lang === 'javascript'
          ? 'js'
          : lang === 'python'
            ? 'py'
            : lang === 'tsx'
              ? 'tsx'
              : lang.slice(0, 8);
    path = `chat/${Date.now()}.${ext}`;
  }
  if (body.projectId) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM projects
       WHERE id = $1::uuid AND owner_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [body.projectId, auth.ownerId],
    );
    if (!rows[0]) return jsonResponse(404, { error: 'project not found' });
  }

  const language = body.language || languageFromPath(path);
  const hash = hashContent(content);
  const { rows } = await db.query<ArtefactRow>(
    `INSERT INTO code_artefacts
       (user_id, project_id, session_id, path, language, content_hash, content)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7)
     RETURNING id, user_id, project_id, session_id, path, language, content_hash,
               s3_key, content, created_at, updated_at`,
    [
      auth.ownerId,
      body.projectId ?? null,
      body.sessionId ?? null,
      path,
      language,
      hash,
      content,
    ],
  );
  const row = rows[0]!;
  return jsonResponse(201, { artefact: mapArtefact(row, true) });
}
