import { afterEach, describe, expect, it, vi } from 'vitest';

describe('cognito-config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('cognitoClientId returns env value', async () => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'cid');
    const mod = await import('./cognito-config');
    expect(mod.cognitoClientId()).toBe('cid');
  });

  it('cognitoRegion returns env value', async () => {
    vi.stubEnv('VITE_COGNITO_REGION', 'us-east-1');
    const mod = await import('./cognito-config');
    expect(mod.cognitoRegion()).toBe('us-east-1');
  });

  it('isCognitoEnabled returns true when both set', async () => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'x');
    vi.stubEnv('VITE_COGNITO_REGION', 'y');
    const mod = await import('./cognito-config');
    expect(mod.isCognitoEnabled()).toBe(true);
  });

  it('isCognitoEnabled returns false when client id missing', async () => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', '');
    vi.stubEnv('VITE_COGNITO_REGION', 'y');
    const mod = await import('./cognito-config');
    expect(mod.isCognitoEnabled()).toBe(false);
  });

  it('allowDevAuth returns true when set', async () => {
    vi.stubEnv('VITE_ALLOW_DEV_AUTH', 'true');
    const mod = await import('./cognito-config');
    expect(mod.allowDevAuth()).toBe(true);
  });

  it('allowDevAuth returns false by default', async () => {
    vi.stubEnv('VITE_ALLOW_DEV_AUTH', '');
    const mod = await import('./cognito-config');
    expect(mod.allowDevAuth()).toBe(false);
  });
});
