/**
 * Phase P1.7 — adversarial isolation fitness for public `/v1` memory.
 *
 * Skips CRDB-backed cases without CRDB_CONNECTION_STRING.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDbClient } from '@walkcroach/db';
import { debitCredits, ensureBalanceRow } from '@walkcroach/ledger';
import { ALL_SCOPES } from './api-keys.js';
import { devBearer, hasCrdb, ideApi } from './test/ide-api.harness.js';

describe('SDK scopes model (P1.6)', () => {
  it('includes content:run alongside memory scopes', () => {
    expect([...ALL_SCOPES].sort()).toEqual(
      ['content:run', 'memory:read', 'memory:write'].sort(),
    );
  });
});

const describeDb = hasCrdb() ? describe : describe.skip;

describeDb('SDK /v1 — isolation fitness (P1.7)', () => {
  process.env.ALLOW_DEV_AUTH = 'true';
  const ownerA = `user:iso-a-${randomUUID()}`;
  const ownerB = `user:iso-b-${randomUUID()}`;
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

  async function ownedProject(ownerId: string): Promise<string> {
    const db = createDbClient();
    try {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO projects (owner_id, name, template_id)
         VALUES ($1, $2, 'blank')
         RETURNING id`,
        [ownerId, `iso ${randomUUID().slice(0, 8)}`],
      );
      const id = rows[0]!.id;
      createdProjectIds.push(id);
      return id;
    } finally {
      await db.close();
    }
  }

  it('key A cannot recall owner B project (404, not 403)', async () => {
    const projectB = await ownedProject(ownerB);
    const minted = await ideApi()
      .post('/v1/keys')
      .set('Authorization', devBearer(ownerA))
      .send({
        name: `iso-a-${randomUUID().slice(0, 8)}`,
        scopes: ['memory:read', 'memory:write'],
      })
      .expect(201);
    createdKeyIds.push(minted.body.id);

    const denied = await ideApi()
      .post('/v1/memory/recall')
      .set('Authorization', `Bearer ${minted.body.key}`)
      .send({ projectId: projectB, query: 'secret' })
      .expect(404);

    expect(denied.body.error).toMatch(/not found|not owned/i);
  });

  it('read-only key cannot remember', async () => {
    const projectId = await ownedProject(ownerA);
    const minted = await ideApi()
      .post('/v1/keys')
      .set('Authorization', devBearer(ownerA))
      .send({
        name: `ro-${randomUUID().slice(0, 8)}`,
        scopes: ['memory:read'],
      })
      .expect(201);
    createdKeyIds.push(minted.body.id);

    const denied = await ideApi()
      .post('/v1/memory/entries')
      .set('Authorization', `Bearer ${minted.body.key}`)
      .send({ projectId, text: 'should fail', kind: 'decision' })
      .expect(403);

    expect(denied.body.error).toMatch(/memory:write/);
  });

  it('revoked key fails closed', async () => {
    const projectId = await ownedProject(ownerA);
    const minted = await ideApi()
      .post('/v1/keys')
      .set('Authorization', devBearer(ownerA))
      .send({
        name: `rev-${randomUUID().slice(0, 8)}`,
        scopes: ['memory:read', 'memory:write'],
      })
      .expect(201);
    createdKeyIds.push(minted.body.id);

    await ideApi()
      .delete(`/v1/keys/${minted.body.id}`)
      .set('Authorization', devBearer(ownerA))
      .expect(200);

    await ideApi()
      .post('/v1/memory/recall')
      .set('Authorization', `Bearer ${minted.body.key}`)
      .send({ projectId, query: 'x' })
      .expect(401);
  });

  it('unscoped recall is rejected client-contract style (400)', async () => {
    await ideApi()
      .post('/v1/memory/recall')
      .set('Authorization', devBearer(ownerA))
      .send({ query: 'no project' })
      .expect(400);
  });

  it('content:run is required for publish (memory:write alone is 403)', async () => {
    const projectId = await ownedProject(ownerA);
    const minted = await ideApi()
      .post('/v1/keys')
      .set('Authorization', devBearer(ownerA))
      .send({
        name: `mw-${randomUUID().slice(0, 8)}`,
        scopes: ['memory:write'],
      })
      .expect(201);
    createdKeyIds.push(minted.body.id);

    const denied = await ideApi()
      .post('/v1/content/publish')
      .set('Authorization', `Bearer ${minted.body.key}`)
      .send({
        projectId,
        source: { kind: 'markdown', content: '# hi' },
        target: { repo: 'acme/demo' },
        writeScope: { mode: 'additive' },
      })
      .expect(403);

    expect(denied.body.error).toMatch(/content:run/);
  });

  it('quota path returns 429 + Retry-After when credits exhausted (P1.5)', async () => {
    const projectId = await ownedProject(ownerA);
    const db = createDbClient();
    try {
      await ensureBalanceRow(db, ownerA);
      await db.query(
        `UPDATE credit_balances
            SET monthly_credits = 0, used_this_month = 0, updated_at = now()
          WHERE owner_id = $1`,
        [ownerA],
      );
      const assert = await debitCredits(db, ownerA, 'memory_remember', projectId);
      expect(assert.ok).toBe(false);
    } finally {
      await db.close();
    }

    const res = await ideApi()
      .post('/v1/memory/entries')
      .set('Authorization', devBearer(ownerA))
      .send({
        projectId,
        text: `quota-${randomUUID()}`,
        kind: 'decision',
        surface: 'sdk',
      })
      .expect(429);

    expect(res.body.code).toBe('QUOTA_EXCEEDED');
    expect(res.headers['retry-after']).toBeTruthy();

    // Restore so other suites on same owner are not poisoned if shared.
    const restore = createDbClient();
    try {
      await restore.query(
        `UPDATE credit_balances
            SET monthly_credits = 100, used_this_month = 0, updated_at = now()
          WHERE owner_id = $1`,
        [ownerA],
      );
    } finally {
      await restore.close();
    }
  });

  it('erase tombstones content and records audit (P1.3/P1.4)', async () => {
    const projectId = await ownedProject(ownerA);
    const auth = devBearer(ownerA);
    const marker = `erase-${randomUUID()}`;

    const remembered = await ideApi()
      .post('/v1/memory/entries')
      .set('Authorization', auth)
      .send({ projectId, text: marker, kind: 'decision', surface: 'sdk' })
      .expect(200);

    await ideApi()
      .post('/v1/memory/erase')
      .set('Authorization', auth)
      .send({
        projectId,
        reason: 'fitness-test right-to-forget',
        entryIds: [remembered.body.id],
      })
      .expect(200);

    const listed = await ideApi()
      .get('/v1/memory/entries')
      .query({ projectId })
      .set('Authorization', auth)
      .expect(200);

    expect(
      (listed.body.entries as Array<{ id: string }>).some(
        (e) => e.id === remembered.body.id,
      ),
    ).toBe(false);

    const audit = await ideApi()
      .get('/v1/memory/audit')
      .query({ projectId })
      .set('Authorization', auth)
      .expect(200);

    expect(
      (audit.body.events as Array<{ action: string }>).some(
        (e) => e.action === 'erase',
      ),
    ).toBe(true);
  });
});
