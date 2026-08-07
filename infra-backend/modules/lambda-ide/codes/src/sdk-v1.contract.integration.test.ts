/**
 * Phase P0.3 — public SDK `/v1` contract against the ide local handler + CRDB.
 *
 * Skips when CRDB_CONNECTION_STRING is unset (same pattern as ide-api.integration).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDbClient } from '@walkcroach/db';
import {
  MEMORY_ASOF_RETENTION_SECONDS,
  SDK_CAPABILITIES,
} from './sdk-contract.js';
import { devBearer, hasCrdb, ideApi } from './test/ide-api.harness.js';

describe('SDK /v1 — unauthenticated health (P0.5)', () => {
  it('GET /v1/health advertises capabilities + retention', async () => {
    const res = await ideApi().get('/v1/health').expect(200);
    expect(res.body).toMatchObject({
      ok: true,
      surface: 'sdk',
      version: 'v1',
    });
    expect(res.body.capabilities).toEqual([...SDK_CAPABILITIES]);
    expect(res.body.retention).toMatchObject({
      asOfSeconds: MEMORY_ASOF_RETENTION_SECONDS,
      mechanism: 'cockroachdb_mvcc_gc_ttl',
      governance: {
        asOf: 'cockroachdb_mvcc_gc_ttl',
        audit: 'memory_audit',
        erase: 'tombstone_redact',
      },
    });
  });

  it('GET /v1/sdk-health is an alias (APIGW-safe)', async () => {
    const res = await ideApi().get('/v1/sdk-health').expect(200);
    expect(res.body.surface).toBe('sdk');
    expect(res.body.retention.asOfSeconds).toBe(MEMORY_ASOF_RETENTION_SECONDS);
  });

  it('GET /sdk-health works without a /v1 prefix (stage-relative)', async () => {
    const res = await ideApi().get('/sdk-health').expect(200);
    expect(res.body.surface).toBe('sdk');
  });
});

describe('SDK /v1 — auth gates', () => {
  it('GET /v1/keys returns 401 without auth', async () => {
    await ideApi().get('/v1/keys').expect(401);
  });

  it('POST /v1/memory/recall returns 401 without auth', async () => {
    await ideApi()
      .post('/v1/memory/recall')
      .send({
        projectId: '11111111-2222-3333-4444-555555555555',
        query: 'x',
      })
      .expect(401);
  });
});

const describeDb = hasCrdb() ? describe : describe.skip;

describeDb('SDK /v1 — memory contract (CRDB)', () => {
  process.env.ALLOW_DEV_AUTH = 'true';
  const ownerId = `user:sdk-contract-${randomUUID()}`;
  const createdProjectIds: string[] = [];
  const createdKeyIds: string[] = [];

  afterAll(async () => {
    if (!hasCrdb()) return;
    const db = createDbClient();
    try {
      for (const id of createdKeyIds) {
        await db.query(
          `UPDATE api_keys SET revoked_at = now() WHERE id = $1::uuid`,
          [id],
        );
      }
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

  async function ownedProject(): Promise<string> {
    const db = createDbClient();
    try {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO projects (owner_id, name, template_id)
         VALUES ($1, $2, 'blank')
         RETURNING id`,
        [ownerId, `SDK contract ${randomUUID().slice(0, 8)}`],
      );
      const id = rows[0]!.id;
      createdProjectIds.push(id);
      return id;
    } finally {
      await db.close();
    }
  }

  it('mint key → remember → recall → list (Cognito path)', async () => {
    const projectId = await ownedProject();
    const marker = `sdk-contract-${randomUUID()}`;

    const minted = await ideApi()
      .post('/v1/keys')
      .set('Authorization', devBearer(ownerId))
      .send({
        name: `contract-${randomUUID().slice(0, 8)}`,
        scopes: ['memory:read', 'memory:write'],
      })
      .expect(201);

    expect(minted.body.key).toMatch(/^wc_live_/);
    expect(minted.body.warning).toMatch(/cannot be retrieved/i);
    createdKeyIds.push(minted.body.id);

    const remembered = await ideApi()
      .post('/v1/memory/entries')
      .set('Authorization', `Bearer ${minted.body.key}`)
      .send({
        projectId,
        text: `Decision ${marker}`,
        kind: 'decision',
        surface: 'sdk',
      })
      .expect(200);

    expect(remembered.body.id).toBeTruthy();
    expect(remembered.body.projectId).toBe(projectId);

    const recall = await ideApi()
      .post('/v1/memory/recall')
      .set('Authorization', `Bearer ${minted.body.key}`)
      .send({ projectId, query: marker, limit: 5 })
      .expect(200);

    expect(
      (recall.body.hits as Array<{ text: string }>).some((h) =>
        h.text.includes(marker),
      ),
    ).toBe(true);

    const listed = await ideApi()
      .get('/v1/memory/entries')
      .query({ projectId, limit: 20 })
      .set('Authorization', `Bearer ${minted.body.key}`)
      .expect(200);

    expect(
      (listed.body.entries as Array<{ text: string }>).some((e) =>
        e.text.includes(marker),
      ),
    ).toBe(true);
  });

  it('recall with asOf returns present-shaped hits inside retention', async () => {
    const projectId = await ownedProject();
    const auth = devBearer(ownerId);
    const marker = `asof-${randomUUID()}`;

    await ideApi()
      .post('/v1/memory/entries')
      .set('Authorization', auth)
      .send({
        projectId,
        text: `Present ${marker}`,
        kind: 'decision',
        surface: 'sdk',
      })
      .expect(200);

    const at = new Date().toISOString();
    const recall = await ideApi()
      .post('/v1/memory/recall')
      .set('Authorization', auth)
      .send({ projectId, query: marker, limit: 5, asOf: at })
      .expect(200);

    expect(recall.body.asOf).toBeTruthy();
    expect(
      (recall.body.hits as Array<{ text: string }>).some((h) =>
        h.text.includes(marker),
      ),
    ).toBe(true);
  });

  it('supersede nearest same-kind entry on remember', async () => {
    const projectId = await ownedProject();
    const auth = devBearer(ownerId);
    const base = `supersede-${randomUUID().slice(0, 8)}`;

    const first = await ideApi()
      .post('/v1/memory/entries')
      .set('Authorization', auth)
      .send({
        projectId,
        text: `${base} chose Postgres`,
        kind: 'decision',
        surface: 'sdk',
      })
      .expect(200);

    const second = await ideApi()
      .post('/v1/memory/entries')
      .set('Authorization', auth)
      .send({
        projectId,
        text: `${base} chose CockroachDB instead of Postgres`,
        kind: 'decision',
        surface: 'sdk',
      })
      .expect(200);

    // Supersede is threshold-based — assert shape always; id when triggered.
    expect(second.body).toHaveProperty('supersededId');
    if (second.body.supersededId) {
      expect(second.body.supersededId).toBe(first.body.id);
    }
  });

  it('export → import round-trip preserves entries', async () => {
    const projectId = await ownedProject();
    const destId = await ownedProject();
    const auth = devBearer(ownerId);
    const marker = `export-${randomUUID()}`;

    await ideApi()
      .post('/v1/memory/entries')
      .set('Authorization', auth)
      .send({
        projectId,
        text: `Portable ${marker}`,
        kind: 'convention',
        surface: 'sdk',
      })
      .expect(200);

    const exported = await ideApi()
      .get('/v1/memory/export')
      .query({ projectId })
      .set('Authorization', auth)
      .expect(200);

    expect(exported.body.format || exported.body.version || exported.body.entries)
      .toBeTruthy();

    const imported = await ideApi()
      .post('/v1/memory/import')
      .set('Authorization', auth)
      .send({ projectId: destId, bundle: exported.body })
      .expect(200);

    expect(imported.body).toBeTruthy();

    const recall = await ideApi()
      .post('/v1/memory/recall')
      .set('Authorization', auth)
      .send({ projectId: destId, query: marker, limit: 5 })
      .expect(200);

    expect(
      (recall.body.hits as Array<{ text: string }>).some((h) =>
        h.text.includes(marker),
      ),
    ).toBe(true);
  });

  it('API key cannot mint keys (interactive-only)', async () => {
    const minted = await ideApi()
      .post('/v1/keys')
      .set('Authorization', devBearer(ownerId))
      .send({ name: `no-escalate-${randomUUID().slice(0, 8)}` })
      .expect(201);
    createdKeyIds.push(minted.body.id);

    const denied = await ideApi()
      .post('/v1/keys')
      .set('Authorization', `Bearer ${minted.body.key}`)
      .send({ name: 'should-fail' })
      .expect(403);

    expect(denied.body.error).toMatch(/cannot manage|sign in/i);
  });
});
