import { describe, it, expect } from 'vitest';
import { MAX_PROFILES, validateProfile, validateProfilesBundle } from './schema';

const ok = {
  id: 'jobs',
  sector: 'recruiting',
  label: 'Extract candidate summary',
  actionId: 'extract_candidate',
  captureType: 'candidate',
  defaultWorkspace: 'Hiring',
  match: { hostSuffix: ['example.com'], pathIncludes: ['/cv/'] },
  fields: ['name', 'role'],
};

describe('validateProfile', () => {
  it('accepts a well-formed profile', () => {
    expect(validateProfile(ok)?.id).toBe('jobs');
  });

  it('accepts optional domHints and draftTone', () => {
    const p = validateProfile({ ...ok, domHints: ['.price'], draftTone: 'warm' });
    expect(p?.domHints).toEqual(['.price']);
    expect(p?.draftTone).toBe('warm');
  });

  it('accepts an empty pathIncludes, meaning host match alone', () => {
    expect(validateProfile({ ...ok, match: { hostSuffix: ['a.com'], pathIncludes: [] } })).not.toBeNull();
  });

  it('rejects an unknown sector', () => {
    expect(validateProfile({ ...ok, sector: 'crypto' })).toBeNull();
  });

  it('rejects missing required fields', () => {
    for (const key of ['id', 'label', 'actionId', 'captureType', 'defaultWorkspace']) {
      const copy: Record<string, unknown> = { ...ok };
      delete copy[key];
      expect(validateProfile(copy), key).toBeNull();
    }
  });

  it('rejects a host suffix that is a pattern, URL, or port', () => {
    // A wildcard here would widen matching far beyond what the label implies.
    for (const host of ['*.example.com', 'https://example.com', 'example.com/path', 'example.com:8443']) {
      expect(
        validateProfile({ ...ok, match: { hostSuffix: [host], pathIncludes: [] } }),
        host,
      ).toBeNull();
    }
  });

  it('rejects a malformed match block', () => {
    expect(validateProfile({ ...ok, match: null })).toBeNull();
    expect(validateProfile({ ...ok, match: { hostSuffix: 'example.com', pathIncludes: [] } })).toBeNull();
    expect(validateProfile({ ...ok, match: { hostSuffix: ['a.com'] } })).toBeNull();
  });

  it('rejects non-string members in string arrays', () => {
    expect(validateProfile({ ...ok, fields: ['name', 42] })).toBeNull();
    expect(validateProfile({ ...ok, match: { hostSuffix: [null], pathIncludes: [] } })).toBeNull();
  });

  it('rejects scalars and arrays', () => {
    expect(validateProfile(null)).toBeNull();
    expect(validateProfile('jobs')).toBeNull();
    expect(validateProfile([ok])).toBeNull();
  });

  it('drops keys it does not know about', () => {
    const p = validateProfile({ ...ok, evil: 'payload' }) as Record<string, unknown>;
    expect(p).not.toHaveProperty('evil');
  });
});

describe('validateProfilesBundle', () => {
  it('accepts a well-formed bundle', () => {
    expect(validateProfilesBundle({ version: 2, profiles: [ok] })?.version).toBe(2);
  });

  it('rejects the whole bundle when one profile is bad', () => {
    // Partial application would silently disable sector actions on some sites.
    expect(
      validateProfilesBundle({ version: 2, profiles: [ok, { id: 'broken' }] }),
    ).toBeNull();
  });

  it('rejects duplicate profile ids', () => {
    expect(validateProfilesBundle({ version: 2, profiles: [ok, { ...ok }] })).toBeNull();
  });

  it('rejects a bad or missing version', () => {
    expect(validateProfilesBundle({ profiles: [ok] })).toBeNull();
    expect(validateProfilesBundle({ version: '2', profiles: [ok] })).toBeNull();
    expect(validateProfilesBundle({ version: 1.5, profiles: [ok] })).toBeNull();
    expect(validateProfilesBundle({ version: 0, profiles: [ok] })).toBeNull();
  });

  it('rejects an empty or non-array profiles list', () => {
    expect(validateProfilesBundle({ version: 2, profiles: [] })).toBeNull();
    expect(validateProfilesBundle({ version: 2, profiles: {} })).toBeNull();
  });

  it('caps how many profiles a bundle may carry', () => {
    const many = Array.from({ length: MAX_PROFILES + 1 }, (_, i) => ({ ...ok, id: `p${i}` }));
    expect(validateProfilesBundle({ version: 2, profiles: many })).toBeNull();
  });

  it('rejects scalars and arrays', () => {
    expect(validateProfilesBundle(null)).toBeNull();
    expect(validateProfilesBundle([ok])).toBeNull();
    expect(validateProfilesBundle('bundle')).toBeNull();
  });
});
