import type { DbClient } from '@walkcroach/db';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import {
  getProjectDbCredentials,
  getProjectSecret,
  projectDbSecretName,
  projectSecretsPrefix,
  putProjectDbCredentials,
  putProjectSecret,
} from '../project-secrets.js';
import { assertCredits, debitCredits } from './billing.js';
import { assertProjectOwner } from './projectArtifacts.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const INLINE_EDIT_DAILY_CAP = Number(process.env.INLINE_EDIT_DAILY_CAP ?? 50);

function shortDbName(projectId: string): string {
  return `wc_app_${projectId.replace(/-/g, '').slice(0, 12)}`;
}

async function countInlineEditsToday(
  db: DbClient,
  ownerId: string,
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::string AS count FROM usage_ledger
     WHERE owner_id = $1 AND action_type = 'inline_edit'
       AND created_at >= date_trunc('day', now())`,
    [ownerId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function handleGetSecrets(
  db: DbClient,
  projectId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const { rows } = await db.query<{ key_name: string }>(
    `SELECT key_name FROM project_secret_keys
     WHERE project_id = $1::uuid
     ORDER BY key_name`,
    [projectId],
  ).catch(() => ({ rows: [] as { key_name: string }[] }));

  const keys = rows.map((r) => r.key_name);
  return jsonResponse(200, {
    secrets: keys.map((key) => ({
      key,
      masked: '••••••••',
    })),
    prefix: projectSecretsPrefix(projectId),
  });
}

export async function handlePutSecret(
  db: DbClient,
  projectId: string,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const body = JSON.parse(rawBody ?? '{}') as { key?: string; value?: string };
  const key = body.key?.trim();
  const value = body.value;
  if (!key || !value) {
    return jsonResponse(400, { error: 'key and value required' });
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key)) {
    return jsonResponse(400, { error: 'invalid secret key name' });
  }

  await putProjectSecret(projectId, key, value);
  await db.query(
    `INSERT INTO project_secret_keys (project_id, key_name)
     VALUES ($1::uuid, $2)
     ON CONFLICT (project_id, key_name) DO NOTHING`,
    [projectId, key],
  );

  return jsonResponse(201, { ok: true, key });
}

export async function handleProvisionDatabase(
  db: DbClient,
  projectId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const credits = await assertCredits(db, auth.ownerId, 'db_provision');
  if (!credits.ok) {
    return jsonResponse(402, {
      error: 'insufficient credits',
      remaining: credits.remaining,
    });
  }

  const existing = await db.query<{ app_database_name: string }>(
    `SELECT app_database_name FROM project_app_resources WHERE project_id = $1::uuid`,
    [projectId],
  );
  if (existing.rows[0]) {
    return jsonResponse(200, {
      ok: true,
      database: existing.rows[0].app_database_name,
      alreadyProvisioned: true,
    });
  }

  const dbName = shortDbName(projectId);
  const adminUrl = process.env.CRDB_CONNECTION_STRING;
  if (!adminUrl) {
    return jsonResponse(500, { error: 'CRDB_CONNECTION_STRING not configured' });
  }

  const admin = createDbClient(adminUrl);
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
  } catch (err) {
    await admin.close();
    return jsonResponse(500, {
      error: `database provision failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  await admin.close();

  const connectionString = adminUrl.replace(
    /\/[^/?]+(\?|$)/,
    `/${dbName}$1`,
  );

  await putProjectDbCredentials(projectId, {
    database: dbName,
    connectionString,
  });

  const prefix = projectSecretsPrefix(projectId);
  await db.query(
    `INSERT INTO project_app_resources (project_id, app_database_name, secrets_prefix)
     VALUES ($1::uuid, $2, $3)`,
    [projectId, dbName, prefix],
  );

  await debitCredits(db, auth.ownerId, 'db_provision', projectId, { database: dbName });

  return jsonResponse(201, {
    ok: true,
    database: dbName,
    proxySqlPath: `/proxy/${projectId}/sql`,
    scaffold: {
      'src/lib/db.ts': DB_SCAFFOLD,
      'src/lib/walkcroach.ts': WALKCROACH_CLIENT_SCAFFOLD,
    },
  });
}

export async function handleProxySql(
  db: DbClient,
  projectId: string,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const body = JSON.parse(rawBody ?? '{}') as {
    sql?: string;
    params?: unknown[];
    readOnly?: boolean;
  };
  const sql = body.sql?.trim();
  if (!sql) return jsonResponse(400, { error: 'sql required' });

  const normalized = sql.toLowerCase();
  if (body.readOnly && !normalized.startsWith('select')) {
    return jsonResponse(403, { error: 'readOnly allows SELECT only' });
  }
  if (
    /\b(drop|truncate|alter|grant|revoke)\b/i.test(sql) &&
    !process.env.ALLOW_DANGEROUS_SQL
  ) {
    return jsonResponse(403, { error: 'statement not allowed' });
  }

  const creds = await getProjectDbCredentials(projectId);
  if (!creds?.connectionString) {
    return jsonResponse(404, { error: 'project database not provisioned' });
  }

  const appDb = createDbClient(creds.connectionString);
  try {
    const { rows } = await appDb.query(sql, body.params ?? []);
    return jsonResponse(200, { rows });
  } catch (err) {
    return jsonResponse(400, {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await appDb.close();
  }
}

export async function handleProxyHttp(
  db: DbClient,
  projectId: string,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const body = JSON.parse(rawBody ?? '{}') as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    secretKey?: string;
    secretHeader?: string;
  };

  if (!body.url?.startsWith('https://')) {
    return jsonResponse(400, { error: 'https url required' });
  }

  const headers: Record<string, string> = {
    ...(body.headers ?? {}),
  };

  if (body.secretKey) {
    const secret = await getProjectSecret(projectId, body.secretKey);
    if (!secret) {
      return jsonResponse(404, { error: 'secret not found' });
    }
    headers[body.secretHeader ?? 'Authorization'] = secret.startsWith('Bearer ')
      ? secret
      : `Bearer ${secret}`;
  }

  const res = await fetch(body.url, {
    method: body.method ?? 'GET',
    headers,
    body: body.body,
  });

  const text = await res.text();
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  return jsonResponse(200, {
    status: res.status,
    headers: responseHeaders,
    body: text.slice(0, 100_000),
  });
}

export async function handleInlineEditUsage(
  db: DbClient,
  ownerId: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const used = await countInlineEditsToday(db, ownerId);
  return {
    allowed: used < INLINE_EDIT_DAILY_CAP,
    remaining: Math.max(0, INLINE_EDIT_DAILY_CAP - used),
  };
}

export async function recordInlineEdit(
  db: DbClient,
  ownerId: string,
  projectId: string,
  path: string,
): Promise<void> {
  await db.query(
    `INSERT INTO usage_ledger (owner_id, project_id, action_type, credits, metadata)
     VALUES ($1, $2::uuid, 'inline_edit', 0, $3::jsonb)`,
    [ownerId, projectId, JSON.stringify({ path })],
  );
}

export async function handleInlineEditQuota(
  db: DbClient,
  projectId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });
  const usage = await handleInlineEditUsage(db, auth.ownerId);
  return jsonResponse(200, usage);
}

export async function handleInlineEdit(
  db: DbClient,
  projectId: string,
  rawBody: string | undefined,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const body = JSON.parse(rawBody ?? '{}') as { path?: string };
  const path = body.path?.trim();
  if (!path) return jsonResponse(400, { error: 'path required' });

  const usage = await handleInlineEditUsage(db, auth.ownerId);
  if (!usage.allowed) {
    return jsonResponse(429, {
      error: 'inline edit daily cap reached',
      remaining: 0,
    });
  }

  await recordInlineEdit(db, auth.ownerId, projectId, path);
  const after = await handleInlineEditUsage(db, auth.ownerId);
  return jsonResponse(200, { ok: true, remaining: after.remaining });
}

export async function handleGetAppResources(
  db: DbClient,
  projectId: string,
  auth: AuthContext,
): Promise<RestResult> {
  const project = await assertProjectOwner(db, projectId, auth);
  if (!project) return jsonResponse(404, { error: 'project not found' });

  const { rows } = await db.query<{
    app_database_name: string;
    provisioned_at: Date;
  }>(
    `SELECT app_database_name, provisioned_at
     FROM project_app_resources WHERE project_id = $1::uuid`,
    [projectId],
  );

  const { rows: secretRows } = await db.query<{ key_name: string }>(
    `SELECT key_name FROM project_secret_keys
     WHERE project_id = $1::uuid ORDER BY key_name`,
    [projectId],
  ).catch(() => ({ rows: [] as { key_name: string }[] }));

  return jsonResponse(200, {
    database: rows[0]
      ? {
          name: rows[0].app_database_name,
          provisionedAt: rows[0].provisioned_at.toISOString(),
          proxySqlPath: `/proxy/${projectId}/sql`,
        }
      : null,
    secrets: secretRows.map((r) => ({ key: r.key_name, masked: '••••••••' })),
  });
}

const DB_SCAFFOLD = `const PROXY = import.meta.env.VITE_WALKCROACH_PROXY ?? ''
const TOKEN = import.meta.env.VITE_WALKCROACH_TOKEN ?? ''

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await fetch(\`\${PROXY}/sql\`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: \`Bearer \${TOKEN}\` } : {}),
    },
    body: JSON.stringify({ sql, params }),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json() as { rows: T[] }
  return data.rows
}
`;

const WALKCROACH_CLIENT_SCAFFOLD = `const PROXY = import.meta.env.VITE_WALKCROACH_PROXY ?? ''
const TOKEN = import.meta.env.VITE_WALKCROACH_TOKEN ?? ''

export async function proxyFetch(
  url: string,
  init: RequestInit & { secretKey?: string; secretHeader?: string } = {},
): Promise<Response> {
  const { secretKey, secretHeader, ...rest } = init
  const res = await fetch(\`\${PROXY}/http\`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: \`Bearer \${TOKEN}\` } : {}),
    },
    body: JSON.stringify({
      url,
      method: rest.method ?? 'GET',
      headers: rest.headers,
      body: rest.body as string | undefined,
      secretKey,
      secretHeader,
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json() as { status: number; body: string; headers: Record<string, string> }
  return new Response(data.body, { status: data.status, headers: data.headers })
}
`;

export { projectDbSecretName };
