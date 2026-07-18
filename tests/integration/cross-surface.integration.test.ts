/**
 * Cross-surface: Web project → IDE mirror → IDE recall (same owner).
 * Chrome capture linking is covered separately when device→Cognito upgrade is available.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { devBearer, resolveSurfaceEnv } from './env.js';

const env = resolveSurfaceEnv();
const describeLive = env && env.allowDevAuth ? describe : describe.skip;

describeLive('cross-surface memory (web project ↔ IDE)', () => {
  const surfaces = env!;
  const ownerId = `user:ci-xsurface-${randomUUID()}`;
  const auth = {
    authorization: devBearer(ownerId),
    'content-type': 'application/json',
  };
  const createdProjectIds: string[] = [];

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await fetch(`${surfaces.apiBaseUrl}/projects/${id}/archive`, {
        method: 'POST',
        headers: auth,
      }).catch(() => undefined);
    }
  });

  it('mirrors IDE decisions onto a Web project and recalls them', async () => {
    const create = await fetch(`${surfaces.apiBaseUrl}/projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: `Cross-surface ${randomUUID().slice(0, 8)}`,
        templateId: 'blank',
      }),
    });
    expect(create.status).toBe(201);
    const project = (await create.json()) as { id: string };
    createdProjectIds.push(project.id);

    const token = `xsurface-${randomUUID()}`;
    const mirror = await fetch(`${surfaces.apiBaseUrl}/ide/v1/memory/mirror`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        projectId: project.id,
        kind: 'preference',
        text: `Use Syne display font for ${token}`,
      }),
    });
    expect(mirror.status).toBe(200);

    const recall = await fetch(`${surfaces.apiBaseUrl}/ide/v1/memory/recall`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        projectId: project.id,
        query: `font ${token}`,
        limit: 8,
        sourceSurfaces: ['ide'],
      }),
    });
    expect(recall.status).toBe(200);
    const body = (await recall.json()) as {
      hits?: Array<{ text: string; sourceSurface?: string }>;
    };
    const hits = body.hits ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.text.includes(token))).toBe(true);
  });
});
