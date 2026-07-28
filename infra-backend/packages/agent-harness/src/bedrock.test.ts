import { afterEach, describe, expect, it } from 'vitest';
import {
  getBedrockRegion,
  getNovaModelId,
  isInvalidModelError,
  formatBedrockModelErrorForLogs,
  formatBedrockErrorForUser,
} from './bedrock.js';

const ENV_KEYS = [
  'BEDROCK_REGION',
  'AWS_REGION',
  'BEDROCK_NOVA_MODEL_ID',
  'NOVA_MODEL_ID',
] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('getBedrockRegion', () => {
  it('defaults to eu-west-2 when nothing is set', () => {
    delete process.env.BEDROCK_REGION;
    delete process.env.AWS_REGION;
    expect(getBedrockRegion()).toBe('eu-west-2');
  });

  it('prefers BEDROCK_REGION over AWS_REGION', () => {
    process.env.BEDROCK_REGION = 'eu-west-1';
    process.env.AWS_REGION = 'us-east-1';
    expect(getBedrockRegion()).toBe('eu-west-1');
  });
});

describe('getNovaModelId', () => {
  it('defaults to the global cross-region profile', () => {
    delete process.env.BEDROCK_NOVA_MODEL_ID;
    delete process.env.NOVA_MODEL_ID;
    expect(getNovaModelId()).toBe('global.amazon.nova-2-lite-v1:0');
  });
});

describe('isInvalidModelError', () => {
  it('matches the exact AWS ValidationException text', () => {
    expect(
      isInvalidModelError(
        new Error('The provided model identifier is invalid.'),
      ),
    ).toBe(true);
  });

  it('does not match an unrelated error', () => {
    expect(isInvalidModelError(new Error('Throttled by Bedrock'))).toBe(
      false,
    );
  });
});

describe('formatBedrockModelErrorForLogs', () => {
  it('appends model/region diagnostic for an invalid-model error', () => {
    const out = formatBedrockModelErrorForLogs(
      new Error('The provided model identifier is invalid.'),
      'eu.amazon.nova-2-lite-v1:0',
      'eu-west-2',
    );
    expect(out).toContain('The provided model identifier is invalid.');
    expect(out).toContain('eu.amazon.nova-2-lite-v1:0');
    expect(out).toContain('eu-west-2');
  });

  it('passes through an unrelated error unchanged', () => {
    const out = formatBedrockModelErrorForLogs(
      new Error('Throttled by Bedrock'),
      'global.amazon.nova-2-lite-v1:0',
      'eu-west-2',
    );
    expect(out).toBe('Throttled by Bedrock');
  });
});

describe('formatBedrockErrorForUser', () => {
  it('never leaks model id, region, or AWS console guidance for an invalid-model error', () => {
    const out = formatBedrockErrorForUser(
      new Error('The provided model identifier is invalid.'),
    );
    expect(out).not.toContain('model identifier');
    expect(out).not.toContain('console');
    expect(out).not.toContain('region');
  });

  it('passes through an unrelated error unchanged', () => {
    const out = formatBedrockErrorForUser(new Error('Throttled by Bedrock'));
    expect(out).toBe('Throttled by Bedrock');
  });
});
