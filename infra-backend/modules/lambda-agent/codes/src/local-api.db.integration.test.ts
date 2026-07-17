import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient } from '@walkcroach/db';
import { api, devBearer, hasCrdb } from './test/local-api.harness.js';

const describeDb = hasCrdb() ? describe : describe.skip;

describeDb('local API — CRDB integration', () => {
  const ownerA = `user:api-test-${randomUUID()}`;
  const ownerB = `user:api-test-${randomUUID()}`;
  const anonOwner = `anon:api-test-${randomUUID()}`;
  const createdProjectIds: string[] = [];

  beforeAll(() => {
    if (!hasCrdb()) return;
    process.env.ALLOW_DEV_AUTH = 'true';
  });

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

  async function createProject(
    ownerId: string,
    name: string,
  ): Promise<string> {
    const res = await api()
      .post('/projects')
      .set('Authorization', devBearer(ownerId))
      .send({ name, templateId: 'todo' })
      .expect(201);
    const id = res.body.id as string;
    createdProjectIds.push(id);
    return id;
  }

  it('POST /projects creates a project for authenticated user', async () => {
    const id = await createProject(ownerA, 'API integration project');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('GET /projects returns only the caller projects', async () => {
    const id = await createProject(ownerA, 'Listed project');

    const res = await api()
      .get('/projects')
      .set('Authorization', devBearer(ownerA))
      .expect(200);

    expect(Array.isArray(res.body.projects)).toBe(true);
    const ids = (res.body.projects as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(id);
  });

  it('GET /projects/:id returns 404 for non-owner', async () => {
    const id = await createProject(ownerA, 'Owner A only');

    await api()
      .get(`/projects/${id}`)
      .set('Authorization', devBearer(ownerB))
      .expect(404);
  });

  it('POST /projects/:id/secrets stores write-only; GET returns masked keys only', async () => {
    const id = await createProject(ownerA, 'Secrets project');
    const secretValue = 'sk_live_api_integration_must_not_leak_12345678';

    await api()
      .post(`/projects/${id}/secrets`)
      .set('Authorization', devBearer(ownerA))
      .send({ key: 'OPENAI_API_KEY', value: secretValue })
      .expect(201);

    const res = await api()
      .get(`/projects/${id}/secrets`)
      .set('Authorization', devBearer(ownerA))
      .expect(200);

    expect(res.body.secrets).toEqual([
      { key: 'OPENAI_API_KEY', masked: '••••••••' },
    ]);
    expect(res.body.prefix).toContain(`/projects/${id}/secrets`);
    expect(JSON.stringify(res.body)).not.toContain(secretValue);
    expect(JSON.stringify(res.body)).not.toContain('sk_live_');
  });

  it('rejects invalid secret key names', async () => {
    const id = await createProject(ownerA, 'Invalid secret key');

    const res = await api()
      .post(`/projects/${id}/secrets`)
      .set('Authorization', devBearer(ownerA))
      .send({ key: 'bad key!', value: 'x' })
      .expect(400);

    expect(res.body).toEqual({ error: 'invalid secret key name' });
  });

  it('POST /proxy/:projectId/sql returns 404 for non-owner (cross-project)', async () => {
    const id = await createProject(ownerA, 'Proxy owner A');

    const res = await api()
      .post(`/proxy/${id}/sql`)
      .set('Authorization', devBearer(ownerB))
      .send({ sql: 'SELECT 1' })
      .expect(404);

    expect(res.body).toEqual({ error: 'project not found' });
  });

  it('POST /proxy/:projectId/http requires https URL', async () => {
    const id = await createProject(ownerA, 'Proxy http validation');

    const res = await api()
      .post(`/proxy/${id}/http`)
      .set('Authorization', devBearer(ownerA))
      .send({ url: 'http://insecure.example' })
      .expect(400);

    expect(res.body).toEqual({ error: 'https url required' });
  });

  it('anonymous owner is capped at one project', async () => {
    const first = await api()
      .post('/projects')
      .set('Authorization', devBearer(anonOwner))
      .send({ name: 'Guest one' })
      .expect(201);
    createdProjectIds.push(first.body.id as string);

    const res = await api()
      .post('/projects')
      .set('Authorization', devBearer(anonOwner))
      .send({ name: 'Guest two' })
      .expect(403);

    expect(res.body.error).toContain('guest project limit');
  });
});
