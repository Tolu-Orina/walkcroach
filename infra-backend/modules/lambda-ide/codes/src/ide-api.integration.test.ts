import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDbClient } from '@walkcroach/db';
import { afterAll } from 'vitest';
import { devBearer, hasCrdb, ideApi } from './test/ide-api.harness.js';

describe('ide local API — public + auth gate', () => {
  it('GET /ide/v1/health', async () => {
    const res = await ideApi().get('/ide/v1/health').expect(200);
    expect(res.body).toMatchObject({ ok: true, surface: 'ide' });
  });

  it('GET /ide/v1/me returns 401 without auth', async () => {
    const res = await ideApi().get('/ide/v1/me').expect(401);
    expect(res.body.error).toMatch(/authorization|sign-in/i);
  });

  it('rejects anonymous Bearer tokens', async () => {
    process.env.ALLOW_DEV_AUTH = 'true';
    const res = await ideApi()
      .get('/ide/v1/me')
      .set('Authorization', `Bearer dev:anon:local-${randomUUID()}`)
      .expect(401);
    expect(res.body.error).toMatch(/sign-in|Cognito/i);
  });
});

const describeDb = hasCrdb() ? describe : describe.skip;

describeDb('ide local API — me + memory (CRDB)', () => {
  process.env.ALLOW_DEV_AUTH = 'true';
  const ownerId = `user:ide-local-${randomUUID()}`;
  const createdProjectIds: string[] = [];

  afterAll(async () => {
    if (!hasCrdb() || createdProjectIds.length === 0) return;
    const db = createDbClient();
    try {
      for (const id of createdProjectIds) {
        await db.query(
          `UPDATE projects SET deleted_at = now(), updated_at = now() WHERE id = $1::uuid`,
          [id],
        );
      }
    } finally {
      await db.close();
    }
  });

  it('GET /ide/v1/me returns owner identity', async () => {
    const res = await ideApi()
      .get('/ide/v1/me')
      .set('Authorization', devBearer(ownerId))
      .expect(200);
    expect(res.body.ownerId).toBe(ownerId);
  });

  it('mirror + recall round-trip for an owned project', async () => {
    const db = createDbClient();
    let projectId = '';
    try {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO projects (owner_id, name, template_id)
         VALUES ($1, $2, 'blank')
         RETURNING id`,
        [ownerId, `IDE local ${randomUUID().slice(0, 8)}`],
      );
      projectId = rows[0]!.id;
      createdProjectIds.push(projectId);
    } finally {
      await db.close();
    }

    const marker = `local-ide-${randomUUID()}`;
    await ideApi()
      .post('/ide/v1/memory/mirror')
      .set('Authorization', devBearer(ownerId))
      .send({ projectId, text: `Decision ${marker}`, kind: 'decision' })
      .expect(200);

    const recall = await ideApi()
      .post('/ide/v1/memory/recall')
      .set('Authorization', devBearer(ownerId))
      .send({ projectId, query: marker, limit: 5 })
      .expect(200);

    expect(
      (recall.body.hits as Array<{ text: string }>).some((h) =>
        h.text.includes(marker),
      ),
    ).toBe(true);
  });
});
