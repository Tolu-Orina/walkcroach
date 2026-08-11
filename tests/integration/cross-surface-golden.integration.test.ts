/**
 * Phase P2.4 / dual-funnel P1 — golden cross-surface memory on the public contract.
 *
 * Flow: create project → remember as web|chrome|cli|ide|desktop|sdk → mint SDK key
 * → recall sees every source_surface tag.
 *
 * Uses HTTP only (no package imports) so `@walkcroach/tests` stays lightweight.
 * Requires WALKCROACH_API_URL + ALLOW_DEV_AUTH=true (and SDK routes on that host).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { devBearer, resolveSurfaceEnv } from './env.js';

const env = resolveSurfaceEnv();
const describeLive = env && env.allowDevAuth ? describe : describe.skip;

const ALL_SURFACES = [
  'web',
  'chrome',
  'ide',
  'cli',
  'desktop',
  'sdk',
] as const;

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

describeLive('cross-surface memory golden (P2.4 / P1)', () => {
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

  it('web|chrome|ide|cli|desktop|sdk remember/recall under 60s', async () => {
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

    const kindBySurface: Record<(typeof ALL_SURFACES)[number], string> = {
      web: 'decision',
      chrome: 'capture',
      ide: 'preference',
      cli: 'convention',
      desktop: 'summary',
      sdk: 'qa',
    };

    for (const surface of ALL_SURFACES) {
      if (surface === 'sdk') continue; // written with API key below
      const write = await fetch(sdkPath(surfaces.apiBaseUrl, '/memory/entries'), {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          projectId: project.id,
          text: `${surface} remembers ${marker}`,
          kind: kindBySurface[surface],
          surface,
        }),
      });
      expect(write.status, `write ${surface}`).toBe(200);
    }

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

    const sdkWrite = await fetch(sdkPath(surfaces.apiBaseUrl, '/memory/entries'), {
      method: 'POST',
      headers: keyAuth,
      body: JSON.stringify({
        projectId: project.id,
        text: `sdk remembers ${marker}`,
        kind: kindBySurface.sdk,
        surface: 'sdk',
      }),
    });
    expect(sdkWrite.status).toBe(200);

    const keyRecall = await fetch(sdkPath(surfaces.apiBaseUrl, '/memory/recall'), {
      method: 'POST',
      headers: keyAuth,
      body: JSON.stringify({
        projectId: project.id,
        query: marker,
        limit: 20,
        surfaces: [...ALL_SURFACES],
      }),
    });
    expect(keyRecall.status).toBe(200);
    const keyHits = (await keyRecall.json()) as {
      hits: Array<{ text: string; surface: string }>;
    };

    const found = new Set(
      keyHits.hits.filter((h) => h.text.includes(marker)).map((h) => h.surface),
    );
    for (const surface of ALL_SURFACES) {
      expect(found.has(surface), `missing surface ${surface}`).toBe(true);
    }

    // Supersede path: IDE restates a web decision near the same text.
    const ideSupersede = await fetch(
      sdkPath(surfaces.apiBaseUrl, '/memory/entries'),
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          projectId: project.id,
          text: `web remembers ${marker} — confirmed in IDE`,
          kind: 'decision',
          surface: 'ide',
        }),
      },
    );
    expect(ideSupersede.status).toBe(200);
    const ideBody = (await ideSupersede.json()) as {
      id: string;
      supersededId?: string | null;
    };
    expect(ideBody.id).toBeTruthy();

    expect(Date.now() - started).toBeLessThan(60_000);
  }, 60_000);
});
