import { listSharedSkills, writeSharedSkill } from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

function normalizeName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return NAME_RE.test(name) ? name : null;
}

/**
 * POST /ide/v1/skills/mirror
 * Body: { name, description, body, sourceSurface? }
 * Account-scoped (owner_id from Cognito sub) — no project link required.
 */
export async function handleSkillsMirror(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{
    name?: string;
    description?: string;
    body?: string;
    sourceSurface?: string;
  }>(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const reqBody = parsed.data;

  const rawName = reqBody.name?.trim();
  if (!rawName) {
    return jsonResponse(400, { error: 'name is required' });
  }
  const name = normalizeName(rawName);
  if (!name) {
    return jsonResponse(400, {
      error:
        'name must be kebab-case (lowercase letters, digits, hyphens), max 80 characters',
    });
  }

  const description = reqBody.description?.trim();
  if (!description) {
    return jsonResponse(400, { error: 'description is required' });
  }
  if (description.length > 2_000) {
    return jsonResponse(400, { error: 'description exceeds 2000 characters' });
  }

  const skillBody = reqBody.body?.trim();
  if (!skillBody) {
    return jsonResponse(400, { error: 'body is required' });
  }
  if (skillBody.length > 20_000) {
    return jsonResponse(400, { error: 'body exceeds 20000 characters' });
  }

  const sourceSurface = (reqBody.sourceSurface ?? 'ide').toLowerCase();

  const db = createDbClient();
  try {
    const id = await writeSharedSkill({
      db,
      ownerId: auth.ownerId,
      name,
      description,
      body: skillBody,
      sourceSurface,
    });
    metricLog('ide.skills.mirror', { ok: true, sourceSurface });
    return jsonResponse(200, { ok: true, id, name });
  } finally {
    await db.close();
  }
}

/** GET /ide/v1/skills */
export async function handleSkillsList(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
  const db = createDbClient();
  try {
    const skills = await listSharedSkills({ db, ownerId: auth.ownerId });
    return jsonResponse(200, { skills });
  } finally {
    await db.close();
  }
}
