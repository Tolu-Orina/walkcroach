import { describe, expect, it } from 'vitest';
import { normalizeIdePath } from './handlers/rest.js';
import { normalizeLocalRepoKey } from './repo-key.js';

describe('Phase C IDE routes', () => {
  it('normalizes stage-prefixed paths', () => {
    expect(normalizeIdePath('/v1/ide/v1/me/projects')).toBe(
      '/ide/v1/me/projects',
    );
    expect(normalizeIdePath('/ide/v1/oauth/token')).toBe(
      '/ide/v1/oauth/token',
    );
  });
});

describe('normalizeLocalRepoKey', () => {
  it('normalizes git remotes', () => {
    expect(
      normalizeLocalRepoKey({
        gitRemoteUrl: 'git@github.com:Org/Repo.git',
      }),
    ).toBe('git:https://github.com/org/repo');
    expect(
      normalizeLocalRepoKey({
        gitRemoteUrl: 'https://github.com/Org/Repo.git',
      }),
    ).toBe('git:https://github.com/org/repo');
  });

  it('strips credentials from https remotes', () => {
    expect(
      normalizeLocalRepoKey({
        gitRemoteUrl: 'https://user:token@github.com/Org/Repo.git',
      }),
    ).toBe('git:https://github.com/org/repo');
  });

  it('hashes workspace path when no remote', () => {
    const a = normalizeLocalRepoKey({ workspacePath: 'C:\\Users\\a\\proj' });
    const b = normalizeLocalRepoKey({ workspacePath: 'C:/Users/a/proj' });
    expect(a).toMatch(/^path:[a-f0-9]{32}$/);
    expect(a).toBe(b);
  });
});
