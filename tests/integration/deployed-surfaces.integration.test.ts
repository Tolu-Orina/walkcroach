import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { devBearer, resolveSurfaceEnv } from './env.js';

const env = resolveSurfaceEnv();
const describeDeployed = env ? describe : describe.skip;

describeDeployed('deployed API — surface health + auth gates', () => {
  // Vitest still evaluates the suite factory when skipped — never call requireSurfaceEnv here.
  const surfaces = env!;

  async function get(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${surfaces.apiBaseUrl}${path}`, init);
  }

  it('GET /health (agent)', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toMatch(/walkcroach/i);
  });

  it('GET /chrome/v1/health', async () => {
    const res = await get('/chrome/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('walkcroach-chrome');
  });

  it('GET /ide/v1/health', async () => {
    const res = await get('/ide/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; surface: string };
    expect(body.ok).toBe(true);
    expect(body.surface).toBe('ide');
  });

  it('protected agent routes return 401 without Authorization', async () => {
    const res = await get('/projects');
    expect(res.status).toBe(401);
  });

  it('protected chrome routes return 401 without Authorization', async () => {
    const res = await get('/chrome/v1/workspaces');
    expect(res.status).toBe(401);
  });

  it('protected ide routes return 401 without Authorization', async () => {
    const res = await get('/ide/v1/me');
    expect(res.status).toBe(401);
  });

  it('agent accepts Bearer dev token when ALLOW_DEV_AUTH is enabled on target', async () => {
    if (!surfaces.allowDevAuth) return;
    const owner = `user:ci-health-${randomUUID()}`;
    const res = await get('/projects', {
      headers: { authorization: devBearer(owner) },
    });
    // 200 with empty list, or 500 if DB down — never 401 when dev auth works
    expect(res.status).not.toBe(401);
  });
});
