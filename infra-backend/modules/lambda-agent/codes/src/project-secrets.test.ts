import { afterEach, describe, expect, it } from 'vitest';
import {
  projectDbSecretName,
  projectSecretsPrefix,
  secretName,
} from './project-secrets.js';

describe('project-secrets paths', () => {
  const prevEnv = process.env.ENVIRONMENT;

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = prevEnv;
  });

  it('builds env-scoped secrets prefix', () => {
    process.env.ENVIRONMENT = 'prod';
    expect(projectSecretsPrefix('proj-1')).toBe(
      'walkcroach/prod/projects/proj-1/secrets',
    );
  });

  it('defaults environment to dev', () => {
    delete process.env.ENVIRONMENT;
    expect(projectSecretsPrefix('x')).toBe('walkcroach/dev/projects/x/secrets');
  });

  it('composes secret and database secret names', () => {
    process.env.ENVIRONMENT = 'test';
    expect(secretName('p1', 'OPENAI_API_KEY')).toBe(
      'walkcroach/test/projects/p1/secrets/OPENAI_API_KEY',
    );
    expect(projectDbSecretName('p1')).toBe('walkcroach/test/projects/p1/database');
  });
});
