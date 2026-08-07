/**
 * Phase P2.4 — golden cross-surface memory on the public memory contract.
 *
 * Flow: create Web project → remember as `web` → mint SDK key → recall with key
 * → remember as `cli` → remember as `ide` (supersede path) → recall sees surfaces.
 *
 * Uses HTTP only (no package imports) so `@walkcroach/tests` stays lightweight.
 * Requires WALKCROACH_API_URL + ALLOW_DEV_AUTH=true (and SDK routes on that host).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { devBearer, resolveSurfaceEnv } from './env.js';

const env = resolveSurfaceEnv();
const describeLive = env && env.allowDevAuth ? describe : describe.skip;

function apiRoot(base: string): string {
  // Shared GW stage is already `v1` → paths are /memory, /keys.
  // ide-local (:3003) needs /v1/memory.
  return /\/v1$/i.test(base) ? base.replace(/\/v1$/i, '') : base;
}

function sdkPath(base: string, path: string): string {
  const root = apiRoot(base);
  const p = path.startsWith('/') ? path : `/${path}`;
  if (/\/v1$/i.test(base) || base.includes('execute-api')) {
    return `${base.replace(/\/$/, '')}${p}`;
  }
  return `${root.replace(/\/$/, '')}/v1${p}`;
}

describeLive('cross-surface memory golden (P2.4)', () => {
  const surfaces = env!;
  const ownerId = `user:ci-golden-${randomUUID()}`;
  const auth = {
    authorization: devBearer(ownerId),
    'content-type': 'application/json',
  };
  const createdProjectIds: string[] = [];
  const createdKeyIds: string[] = [];

  afterAll(async () => {
    for (const id of createdKeyIds) {
      await fetch(sdkPath(surfaces.apiBaseUrl, `/keys/${id}`), {
        method: 'DELETE',
        headers: auth,
      }).catch(() => undefined);
    }
    for (const id of createdProjectIds) {
      await fetch(`${surfaces.apiBaseUrl}/projects/${id}/archive`, {
        method: 'POST',
        headers: auth,
      }).catch(() => undefined);
    }
  });

  it('web → SDK key → cli → ide remember/recall under 60s', async () => {
    const started = Date.now();
    const marker = `golden-${randomUUID().slice(0, 10)}`;

    const create = await fetch(`${surfaces.apiBaseUrl}/projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: `Golden ${randomUUID().slice(0, 8)}`,
        templateId: 'blank',
      }),
    });
    expect(create.status).toBe(201);
    const project = (await create.json()) as { id: string };
    createdProjectIds.push(project.id);

    const webWrite = await fetch(sdkPath(surfaces.apiBaseUrl, '/memory/entries'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        projectId: project.id,
        text: `Web chose Syne for display (${marker})`,
        kind: 'decision',
        surface: 'web',
      }),
    });
    expect(webWrite.status).toBe(200);

    const minted = await fetch(sdkPath(surfaces.apiBaseUrl, '/keys'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: `golden-${randomUUID().slice(0, 6)}`,
        scopes: ['memory:read', 'memory:write'],
      }),
    });
    expect(minted.status).toBe(201);
    const keyBody = (await minted.json()) as { id: string; key: string };
    createdKeyIds.push(keyBody.id);
    expect(keyBody.key).toMatch(/^wc_live_/);

    const keyAuth = {
      authorization: `Bearer ${keyBody.key}`,
      'content-type': 'application/json',
    };

    const keyRecall = await fetch(sdkPath(surfaces.apiBaseUrl, '/memory/recall'), {
      method: 'POST',
      headers: keyAuth,
      body: JSON.stringify({ projectId: project.id, query: marker, limit: 8 }),
    });
    expect(keyRecall.status).toBe(200);
    const keyHits = (await keyRecall.json()) as {
      hits: Array<{ text: string; surface: string }>;
    };
    expect(
      keyHits.hits.some((h) => h.text.includes(marker) && h.surface === 'web'),
    ).toBe(true);

    const cliWrite = await fetch(sdkPath(surfaces.apiBaseUrl, '/memory/entries'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        projectId: project.id,
        text: `CLI notes ${marker} stays on Cockroach`,
        kind: 'convention',
        surface: 'cli',
      }),
    });
    expect(cliWrite.status).toBe(200);

    const ideWrite = await fetch(sdkPath(surfaces.apiBaseUrl, '/memory/entries'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        projectId: project.id,
        text: `Web chose Syne for display (${marker}) — confirmed in IDE`,
        kind: 'decision',
        surface: 'ide',
      }),
    });
    expect(ideWrite.status).toBe(200);
    const ideBody = (await ideWrite.json()) as { id: string; supersededId?: string | null };
    expect(ideBody.id).toBeTruthy();

    const finalRecall = await fetch(sdkPath(surfaces.apiBaseUrl, '/memory/recall'), {
      method: 'POST',
      headers: keyAuth,
      body: JSON.stringify({
        projectId: project.id,
        query: marker,
        limit: 10,
        surfaces: ['web', 'cli', 'ide', 'desktop', 'chrome'],
      }),
    });
    expect(finalRecall.status).toBe(200);
    const finalHits = (await finalRecall.json()) as {
      hits: Array<{ surface: string; text: string }>;
    };
    expect(finalHits.hits.some((h) => h.surface === 'ide')).toBe(true);
    expect(finalHits.hits.some((h) => h.surface === 'cli')).toBe(true);

    expect(Date.now() - started).toBeLessThan(60_000);
  }, 60_000);
});
