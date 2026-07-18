import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveSurfaceEnv } from './env.js';

const env = resolveSurfaceEnv();
const describeLive = env && env.allowDevAuth ? describe : describe.skip;

describeLive('deployed Chrome API — device session + workspace', () => {
  const surfaces = env!;
  const createdWorkspaceIds: string[] = [];
  let accessToken = '';

  afterAll(async () => {
    if (!accessToken) return;
    for (const id of createdWorkspaceIds) {
      await fetch(`${surfaces.apiBaseUrl}/chrome/v1/workspaces/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${accessToken}` },
      }).catch(() => undefined);
    }
  });

  it('POST /chrome/v1/device/session mints a device token', async () => {
    const res = await fetch(`${surfaces.apiBaseUrl}/chrome/v1/device/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accessToken: string;
      ownerId: string;
      deviceKey?: string;
    };
    expect(body.accessToken).toMatch(/^wc1\./);
    expect(body.ownerId).toMatch(/^anon:device:/);
    expect(body.deviceKey).toBeTruthy();
    accessToken = body.accessToken;
  });

  it('POST /chrome/v1/workspaces creates a named workspace', async () => {
    expect(accessToken).toBeTruthy();
    const name = `CI workspace ${randomUUID().slice(0, 8)}`;
    const res = await fetch(`${surfaces.apiBaseUrl}/chrome/v1/workspaces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      workspace: { id: string; name: string };
    };
    expect(body.workspace.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.workspace.name).toBe(name);
    createdWorkspaceIds.push(body.workspace.id);
  });

  it('GET /chrome/v1/workspaces lists the workspace for the device owner', async () => {
    const res = await fetch(`${surfaces.apiBaseUrl}/chrome/v1/workspaces`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaces: Array<{ id: string }>;
    };
    const ids = body.workspaces.map((w) => w.id);
    for (const id of createdWorkspaceIds) {
      expect(ids).toContain(id);
    }
  });
});
