import { afterAll, describe, expect, it } from 'vitest';
import { api } from './test/local-api.harness.js';

describe('local API — public routes', () => {
  it('GET /health returns service status without auth', async () => {
    const res = await api().get('/health').expect(200);
    expect(res.body).toEqual({ ok: true, service: 'walkcroach-backend' });
  });

  it('OPTIONS /projects returns CORS preflight', async () => {
    const res = await api()
      .options('/projects')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-headers']).toContain('authorization');
  });
});

describe('local API — auth gate (no database required)', () => {
  const protectedRoutes: Array<{
    name: string;
    method: 'get' | 'post';
    path: string;
    body?: Record<string, unknown>;
  }> = [
    { name: 'list projects', method: 'get', path: '/projects' },
    {
      name: 'create project',
      method: 'post',
      path: '/projects',
      body: { name: 'Auth gate test' },
    },
    {
      name: 'list secrets',
      method: 'get',
      path: '/projects/00000000-0000-4000-8000-000000000001/secrets',
    },
    {
      name: 'proxy sql',
      method: 'post',
      path: '/proxy/00000000-0000-4000-8000-000000000001/sql',
      body: { sql: 'SELECT 1' },
    },
    {
      name: 'proxy http',
      method: 'post',
      path: '/proxy/00000000-0000-4000-8000-000000000001/http',
      body: { url: 'https://example.com' },
    },
    { name: 'usage', method: 'get', path: '/me/usage' },
  ];

  it.each(protectedRoutes)('$name returns 401 without Authorization', async (route) => {
    const agent = api();
    const req =
      route.method === 'get'
        ? agent.get(route.path)
        : agent.post(route.path).send(route.body ?? {});
    const res = await req.expect(401);
    expect(res.body).toEqual({ error: 'authorization required' });
  });

  it('rejects dev tokens when ALLOW_DEV_AUTH=false', async () => {
    const prev = process.env.ALLOW_DEV_AUTH;
    process.env.ALLOW_DEV_AUTH = 'false';
    try {
      const res = await api()
        .get('/projects')
        .set('Authorization', 'Bearer dev:user:blocked')
        .expect(401);
      expect(res.body).toEqual({ error: 'authorization required' });
    } finally {
      if (prev === undefined) delete process.env.ALLOW_DEV_AUTH;
      else process.env.ALLOW_DEV_AUTH = prev;
    }
  });
});

afterAll(() => {
  // supertest keeps server ref; nothing to close for in-memory handler
});
