import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { devBearer, resolveSurfaceEnv } from './env.js';

const env = resolveSurfaceEnv();
const describeLive = env && env.allowDevAuth ? describe : describe.skip;

describeLive('deployed IDE API — auth + link + memory', () => {
  const surfaces = env!;
  const ownerId = `user:ci-ide-${randomUUID()}`;
  const auth = { authorization: devBearer(ownerId) };
  const createdProjectIds: string[] = [];
  const createdLinkIds: string[] = [];

  afterAll(async () => {
    for (const id of createdLinkIds) {
      await fetch(`${surfaces.apiBaseUrl}/ide/v1/links/${id}`, {
        method: 'DELETE',
        headers: auth,
      }).catch(() => undefined);
    }
    for (const id of createdProjectIds) {
      await fetch(`${surfaces.apiBaseUrl}/projects/${id}/archive`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
      }).catch(() => undefined);
    }
  });

  it('rejects anonymous owners on /ide/v1/me', async () => {
    const res = await fetch(`${surfaces.apiBaseUrl}/ide/v1/me`, {
      headers: {
        authorization: `Bearer dev:anon:ci-${randomUUID()}`,
      },
    });
    expect(res.status).toBe(401);
  });

  it('GET /ide/v1/me works for Cognito-shaped dev user token', async () => {
    const res = await fetch(`${surfaces.apiBaseUrl}/ide/v1/me`, {
      headers: auth,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ownerId: string };
    expect(body.ownerId).toBe(ownerId);
  });

  it('creates a web project, links IDE repo key, mirrors and recalls memory', async () => {
    const projectRes = await fetch(`${surfaces.apiBaseUrl}/projects`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `CI IDE project ${randomUUID().slice(0, 8)}`,
        templateId: 'blank',
      }),
    });
    expect(projectRes.status).toBe(201);
    const project = (await projectRes.json()) as { id: string };
    createdProjectIds.push(project.id);

    const linkRes = await fetch(`${surfaces.apiBaseUrl}/ide/v1/links`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        gitRemoteUrl: `https://github.com/walkcroach/ci-${randomUUID().slice(0, 8)}.git`,
        localRepoDisplay: 'ci-fixture',
      }),
    });
    expect(linkRes.status).toBe(200);
    const linkBody = (await linkRes.json()) as { link: { id: string } };
    expect(linkBody.link.id).toBeTruthy();
    createdLinkIds.push(linkBody.link.id);

    const marker = `ci-memory-${randomUUID()}`;
    const mirrorRes = await fetch(`${surfaces.apiBaseUrl}/ide/v1/memory/mirror`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        text: `Prefer PostgreSQL for ${marker}`,
        kind: 'decision',
      }),
    });
    expect(mirrorRes.status).toBe(200);
    const mirrored = (await mirrorRes.json()) as { ok: boolean; id: string };
    expect(mirrored.ok).toBe(true);
    expect(mirrored.id).toBeTruthy();

    const recallRes = await fetch(`${surfaces.apiBaseUrl}/ide/v1/memory/recall`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        query: marker,
        limit: 5,
      }),
    });
    expect(recallRes.status).toBe(200);
    const recalled = (await recallRes.json()) as {
      hits: Array<{ text: string }>;
    };
    expect(recalled.hits.some((h) => h.text.includes(marker))).toBe(true);
  });
});
