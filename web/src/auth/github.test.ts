import { afterEach, describe, expect, it, vi } from 'vitest';

describe('github', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('isGithubAppEnabled returns true when env is "true"', async () => {
    vi.stubEnv('VITE_GITHUB_APP_ENABLED', 'true');
    const mod = await import('./github');
    expect(mod.isGithubAppEnabled()).toBe(true);
  });

  it('isGithubAppEnabled returns false by default', async () => {
    vi.stubEnv('VITE_GITHUB_APP_ENABLED', '');
    const mod = await import('./github');
    expect(mod.isGithubAppEnabled()).toBe(false);
  });

  it('allowGithubPat returns true when env is "true"', async () => {
    vi.stubEnv('VITE_ALLOW_GITHUB_PAT', 'true');
    const mod = await import('./github');
    expect(mod.allowGithubPat()).toBe(true);
  });

  it('allowGithubPat returns false by default', async () => {
    vi.stubEnv('VITE_ALLOW_GITHUB_PAT', '');
    const mod = await import('./github');
    expect(mod.allowGithubPat()).toBe(false);
  });
});
