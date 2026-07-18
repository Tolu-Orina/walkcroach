import { describe, expect, it } from 'vitest';
import { truncateExtract, MAX_EXTRACT_CHARS } from './util.js';
import { matchStreamRoute, normalizeChromePath } from './handlers/rest.js';

describe('truncateExtract', () => {
  it('collapses whitespace and caps length', () => {
    expect(truncateExtract('  hello   world  ')).toBe('hello world');
    const long = 'a'.repeat(MAX_EXTRACT_CHARS + 50);
    expect(truncateExtract(long).length).toBe(MAX_EXTRACT_CHARS + 1); // + ellipsis
  });
});

describe('matchStreamRoute', () => {
  it('matches chrome stream endpoints', () => {
    expect(matchStreamRoute('POST', '/chrome/v1/summarize')).toBe('summarize');
    expect(matchStreamRoute('POST', '/v1/chrome/v1/ask')).toBe('ask');
    expect(matchStreamRoute('POST', '/chrome/v1/extract/propose')).toBe(
      'propose',
    );
    expect(matchStreamRoute('GET', '/chrome/v1/summarize')).toBeNull();
  });
});

describe('normalizeChromePath', () => {
  it('strips stage prefix', () => {
    expect(normalizeChromePath('/v1/chrome/v1/health')).toBe(
      '/chrome/v1/health',
    );
  });
});
