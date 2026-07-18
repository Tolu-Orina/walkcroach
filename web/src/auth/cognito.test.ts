import { describe, expect, it } from 'vitest';
import { parseIdToken } from './cognito';

function encode(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload));
  return `hdr.${b64}.sig`;
}

describe('parseIdToken', () => {
  it('extracts sub, email, name', () => {
    const result = parseIdToken(encode({ sub: 'u1', email: 'a@b', name: 'N' }));
    expect(result).toEqual({ sub: 'u1', email: 'a@b', name: 'N' });
  });

  it('handles url-safe base64 characters', () => {
    const payload = { sub: 'a+b/c=', email: 'e' };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const result = parseIdToken(`h.${b64}.s`);
    expect(result.sub).toBe('a+b/c=');
  });

  it('throws when payload segment missing', () => {
    expect(() => parseIdToken('single')).toThrow('invalid id token');
  });

  it('throws when sub is missing from payload', () => {
    expect(() => parseIdToken(encode({ email: 'e' }))).toThrow('id token missing sub');
  });

  it('returns undefined for missing optional fields', () => {
    const result = parseIdToken(encode({ sub: 's' }));
    expect(result.email).toBeUndefined();
    expect(result.name).toBeUndefined();
  });
});
