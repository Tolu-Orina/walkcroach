import { describe, expect, it } from 'vitest';
import { chromeApi, hasCrdb } from './test/chrome-api.harness.js';

describe('chrome local API — public + auth gate', () => {
  it('GET /chrome/v1/health', async () => {
    const res = await chromeApi().get('/chrome/v1/health').expect(200);
    expect(res.body).toMatchObject({
      ok: true,
      service: 'walkcroach-chrome',
    });
  });

  it('OPTIONS preflight', async () => {
    await chromeApi()
      .options('/chrome/v1/workspaces')
      .set('Origin', 'chrome-extension://test')
      .expect(204);
  });

  it('GET /chrome/v1/workspaces returns 401 without auth', async () => {
    const res = await chromeApi().get('/chrome/v1/workspaces').expect(401);
    expect(res.body).toEqual({ error: 'authorization required' });
  });
});

const describeDb = hasCrdb() ? describe : describe.skip;

describeDb('chrome local API — device session (CRDB)', () => {
  it('POST /chrome/v1/device/session mints wc1 token', async () => {
    process.env.ALLOW_DEV_AUTH = 'true';
    process.env.CHROME_DEVICE_SIGNING_KEY ??=
      'walkcroach-chrome-dev-signing-key';
    const res = await chromeApi()
      .post('/chrome/v1/device/session')
      .send({})
      .expect(200);
    expect(res.body.accessToken).toMatch(/^wc1\./);
    expect(res.body.ownerId).toMatch(/^anon:device:/);
    expect(res.body.deviceKey).toBeTruthy();
  });

  it('creates and lists a workspace with device token', async () => {
    process.env.ALLOW_DEV_AUTH = 'true';
    process.env.CHROME_DEVICE_SIGNING_KEY ??=
      'walkcroach-chrome-dev-signing-key';
    const session = await chromeApi()
      .post('/chrome/v1/device/session')
      .send({})
      .expect(200);

    const created = await chromeApi()
      .post('/chrome/v1/workspaces')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .send({ name: 'Local harness workspace' })
      .expect(201);

    expect(created.body.workspace.name).toBe('Local harness workspace');

    const listed = await chromeApi()
      .get('/chrome/v1/workspaces')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(200);

    const ids = (listed.body.workspaces as Array<{ id: string }>).map(
      (w) => w.id,
    );
    expect(ids).toContain(created.body.workspace.id);

    await chromeApi()
      .delete(`/chrome/v1/workspaces/${created.body.workspace.id}`)
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(200);
  });
});
